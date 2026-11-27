"""Offline GTFS-RT deadline replay; no network, database or production writes.
Conservative research labels, not a replacement for production V4 settlement.
Input: raw .pb or .pb.gz files named with UTC collection timestamp as in R2.
"""
import argparse, csv, gzip, json, re, math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

OFFSETS=range(-90,61,15)
WINDOWS=(300,420,600)
ROUTES=set('123467')

def varint(b,i):
    v=0
    for shift in range(0,70,7):
        if i>=len(b): raise ValueError('truncated varint')
        x=b[i]; i+=1; v|=(x&127)<<shift
        if x<128: return v,i
    raise ValueError('invalid varint')

def fields(b):
    out=defaultdict(list); i=0
    while i<len(b):
        tag,i=varint(b,i); n,w=tag>>3,tag&7
        if not n: raise ValueError('invalid tag')
        if w==0: v,i=varint(b,i)
        elif w==2:
            length,i=varint(b,i); end=i+length
            if end>len(b): raise ValueError('truncated field')
            v=b[i:end]; i=end
        elif w in (1,5):
            size=8 if w==1 else 4; v=b[i:i+size]; i+=size
            if len(v)!=size: raise ValueError('truncated fixed field')
        else: raise ValueError('unsupported wire type')
        out[n].append(v)
    return out

def get(f,n,default=None): return f.get(n,[default])[-1]
def sub(f,n): return fields(get(f,n,b''))
def txt(f,n): return get(f,n,b'').decode('utf-8')
def decode(raw,collected):
    f=fields(raw); h=sub(f,1); source=get(h,3)
    if not source or get(h,2,0)!=0 or not 0<=collected-source<=30: return None
    trips={}
    for e in f.get(2,[]):
        e=fields(e)
        if get(e,2,0): continue
        for kind in (3,4):
            for payload in e.get(kind,[]):
                r=fields(payload); d=sub(r,1); route=txt(d,5); ident=txt(d,1); date=txt(d,3)
                if route not in ROUTES or not ident or not re.fullmatch(r'\d{8}',date): continue
                key=(route,ident,date,txt(d,2)); t=trips.setdefault(key,{'stops':{},'vehicles':[],'cancel':False,'conflict':False})
                rel=get(d,4,0)
                if rel==3: t['cancel']=True; continue
                if rel!=0: t['conflict']=True; continue
                if kind==3:
                    for p in r.get(2,[]):
                        s=fields(p); stop=txt(s,4)
                        if not re.fullmatch(r'\d{3}[NS]',stop): continue
                        item=(get(s,1),get(s,5,0),get(sub(s,2),2))
                        if stop in t['stops'] and t['stops'][stop]!=item: t['conflict']=True
                        t['stops'][stop]=item
                else:
                    stop=txt(r,7); status=get(r,4); moved=get(r,5); seq=get(r,3); vid=txt(sub(r,8),1)
                    if re.fullmatch(r'\d{3}[NS]',stop) and status in (0,1,2) and moved and 0<=source-moved<=75:
                        t['vehicles'].append((stop,seq,status,moved,vid))
    return {'source':source,'collected':collected,'trips':trips}

def arrival_bounds(frames,key,stop,opening,end):
    """Observed interval: lower means not yet arrived, upper means already arrived.
    No inference from an ETA alone, missing records, or first late STOPPED report.
    Sequence evidence only when target sequence is explicitly known and consistent.
    """
    lower=upper=None; conflict=False; ids=set(); target_seqs=set(); movements=[]; last_seq=None; seq_stops={}
    for f in frames:
        if not opening<=f['source']<=end or f['collected']>end: continue
        t=f['trips'].get(key)
        if not t: continue
        conflict|=t['cancel'] or t['conflict']
        target=t['stops'].get(stop)
        if target:
            seq,rel,_=target
            if rel!=0: conflict=True
            if seq is not None: target_seqs.add(seq)
        for s,seq,status,moved,vid in t['vehicles']:
            if s[-1]!=stop[-1]: conflict=True; continue
            if moved<opening: continue
            if vid: ids.add(vid)
            movements.append((f['source'],s,seq,status,moved))
    if len(ids)>1 or len(target_seqs)>1: conflict=True
    target_seq=next(iter(target_seqs)) if len(target_seqs)==1 else None
    for source,s,seq,status,moved in sorted(movements,key=lambda x:(x[4],x[0])):
        if seq is not None:
            if last_seq is not None and seq<last_seq: conflict=True
            if seq in seq_stops and seq_stops[seq]!=s: conflict=True
            seq_stops[seq]=s; last_seq=seq
        arrived=(s==stop and status==1) or (target_seq is not None and seq is not None and seq>target_seq)
        upstream=(s==stop and status in (0,2)) or (target_seq is not None and seq is not None and seq<target_seq)
        if arrived: upper=source if upper is None else min(upper,source)
        elif upstream: lower=moved if lower is None else max(lower,moved)
    if lower is not None and upper is not None and lower>=upper: conflict=True
    return lower,upper,conflict

def label(bounds,deadline):
    lo,hi,conflict=bounds
    if conflict: return 'VOID'
    if hi is not None and hi<=deadline: return 'YES'
    if lo is not None and lo>deadline: return 'NO'
    return 'VOID'

def baseline(eta,opened,deadline):
    z=(deadline-eta)/max(60,(eta-opened)*.35)
    return max(.05,min(.95,1/(1+math.exp(-z))))

def replay(frames,stops=None):
    frames=sorted((f for f in frames if f),key=lambda x:x['source']); seen=set(); results=[]
    if not frames: return results
    last=max(f['collected'] for f in frames)
    for f in frames:
        opened=f['collected']; source=f['source']
        for key,t in f['trips'].items():
            if t['cancel'] or t['conflict']: continue
            for stop,(seq,rel,eta) in t['stops'].items():
                if stops and (key[0],stop) not in stops: continue
                mk=(key,stop)
                if mk in seen or rel!=0 or eta is None or not 360<=eta-opened<=960: continue
                if any(v[0]==stop and v[2]==1 for v in t['vehicles']): continue
                # Exclude right-censored samples; all alternatives share same cohort.
                if eta+60+max(WINDOWS)>last: continue
                seen.add(mk)
                for offset in OFFSETS:
                    deadline=eta+offset
                    if deadline-opened<180: continue
                    for window in WINDOWS:
                        b=arrival_bounds(frames,key,stop,source,deadline+window)
                        results.append(dict(route=key[0],trip='|'.join(key),stop=stop,opened=opened,eta=eta,offset=offset,window=window,deadline=deadline,probability=baseline(eta,opened,deadline),outcome=label(b,deadline),lower=b[0],upper=b[1],conflict=b[2]))
    return results

def summary(rows):
    groups=defaultdict(list)
    for r in rows: groups[(r['offset'],r['window'])].append(r)
    result=[]
    for (offset,window),rs in sorted(groups.items()):
        n=len(rs); y=sum(r['outcome']=='YES' for r in rs); no=sum(r['outcome']=='NO' for r in rs); v=n-y-no
        result.append(dict(offset=offset,window=window,n=n,yes=y,no=no,void=v,void_rate=v/n,yes_decisive=y/(y+no) if y+no else None,opening_target=sum(.30<=r['probability']<=.70 for r in rs)/n,brier=sum((r['probability']-(r['outcome']=='YES'))**2 for r in rs if r['outcome']!='VOID')/(y+no) if y+no else None))
    return result

def collection_time(path):
    m=re.search(r'(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z',path.name)
    if not m: raise ValueError(f'No collection timestamp: {path.name}')
    date,h,mi,s,ms=m.groups(); return datetime.fromisoformat(f'{date}T{h}:{mi}:{s}.{ms}+00:00').timestamp()

def main():
    p=argparse.ArgumentParser(); p.add_argument('directory',type=Path); p.add_argument('--output',type=Path,default=Path('replay-results.json')); p.add_argument('--stops',type=Path,help='JSON mapping route to approved stop IDs'); args=p.parse_args()
    frames=[]; rejected=[]
    for path in sorted(args.directory.rglob('*')):
        if not (path.name.endswith('.pb') or path.name.endswith('.pb.gz')): continue
        try:
            raw=gzip.decompress(path.read_bytes()) if path.suffix=='.gz' else path.read_bytes(); f=decode(raw,collection_time(path))
            if f: frames.append(f)
            else: rejected.append(path.name)
        except (ValueError,UnicodeError,OSError) as e: rejected.append(f'{path.name}: {e}')
    stops={(r,s) for r,ss in json.loads(args.stops.read_text()).items() for s in ss} if args.stops else None
    rows=replay(frames,stops); args.output.write_text(json.dumps({'frames':len(frames),'rejected':rejected,'summary':summary(rows),'rows':rows},indent=2))
    print(json.dumps({'frames':len(frames),'rejected':len(rejected),'evaluations':len(rows),'summary':summary(rows)},indent=2))
if __name__=='__main__': main()
