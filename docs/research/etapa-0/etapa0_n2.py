import json,glob,collections,statistics as st
import os
OUT=os.environ.get("EI_OUT", "out").rstrip("/") + "/"
B={"Stability":1122,"Might":740,"Protection":717,"Resolution":873,"Fury":725,"Aegis":743}
data=collections.defaultdict(lambda: collections.defaultdict(list))  # boon -> acct -> [(o,g,active,T,N)]
for f in sorted(glob.glob(OUT+"*.json")):
    d=json.load(open(f)); T=d["durationMS"]
    sq=[p for p in d["players"] if not p.get("notInSquad")]
    N=max(1,len(sq)-1)
    merged=collections.defaultdict(lambda: collections.defaultdict(lambda:[0,0,0]))
    for p in sq:
        acc=p.get("account") or p.get("name"); act=(p.get("activeTimes") or [0])[0]
        vol={b["id"]:b["buffVolumeData"][0]["outgoing"] for b in p.get("squadBuffVolumes") or [] if b.get("buffVolumeData")}
        gen={b["id"]:b["buffData"][0]["generation"] for b in p.get("squadBuffs") or []}
        for bn,i in B.items():
            data[bn][acc].append((vol.get(i,0),gen.get(i,0),act,T,N))
def rank(vals):
    order=sorted(vals,key=lambda k:-vals[k]); return {k:i+1 for i,k in enumerate(order)}
def spearman(a,b):
    ks=list(a); n=len(ks)
    if n<3: return float("nan")
    d2=sum((a[k]-b[k])**2 for k in ks); return 1-6*d2/(n*(n*n-1))
print("Peso da média entre lutas: tempo ativo da fonte (atual) × duração da fase × destinatários (T×N, o que a auditoria indica)")
print("boon | jogadores | Spearman dos rankings | top-5 em comum | maior diferença relativa de valor | jogadores que mudam >=3 posições")
for bn in B:
    A={};Bv={};effA={};effB={}
    for acc,L in data[bn].items():
        if sum(x[0] for x in L)<=0: continue
        wa=sum(x[2] for x in L); wb=sum(x[3]*x[4] for x in L)
        if wa<=0: continue
        A[acc]=sum(x[0]*x[2] for x in L)/wa; Bv[acc]=sum(x[0]*x[3]*x[4] for x in L)/wb
        effA[acc]=sum(x[1]*x[2] for x in L)/max(1e-9,sum(x[0]*x[2] for x in L)); effB[acc]=sum(x[1]*x[3]*x[4] for x in L)/max(1e-9,sum(x[0]*x[3]*x[4] for x in L))
    ra,rb=rank(A),rank(Bv)
    top=lambda r:{k for k,v in r.items() if v<=5}
    rel=max(abs(A[k]-Bv[k])/max(A[k],1e-9) for k in A)
    moved=sum(1 for k in A if abs(ra[k]-rb[k])>=3)
    erel=max(abs(effA[k]-effB[k]) for k in effA)
    print("  %-10s %3d | %.3f | %d/5 | %.1f%% | %d | maior dif. absoluta da eficiência: %.3f"%(bn,len(A),spearman(ra,rb),len(top(ra)&top(rb)),rel*100,moved,erel))
# eficiência: razão dos totais x média das razões por luta
print("\nAgregar a eficiência (Stability e Might): razão das médias ponderadas × média simples das razões por luta")
for bn in ["Stability","Might"]:
    diffs=[]
    for acc,L in data[bn].items():
        per=[x[1]/x[0] for x in L if x[0]>0.005]
        if len(per)<3: continue
        ratio=sum(x[1]*x[2] for x in L)/max(1e-9,sum(x[0]*x[2] for x in L))
        diffs.append(abs(ratio-sum(per)/len(per)))
    if diffs: print("  %-10s jogadores com >=3 lutas: %d | diferença absoluta mediana %.3f | máxima %.3f"%(bn,len(diffs),st.median(diffs),max(diffs)))
