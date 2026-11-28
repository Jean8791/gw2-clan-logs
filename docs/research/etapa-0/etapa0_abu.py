import json,collections,statistics as st
rows=json.load(open("/tmp/etapa0-rows.json"))
ours={"Stability":1122,"Might":740,"Quickness":1187,"Protection":717,"Aegis":743,"Resistance":26980,"Resolution":873,"Fury":725,"Superspeed":5974}
print("boon | pares | BVU=g/o mediana | ABU=g/(overstack+wasted) mediana | |BVU−ABU| mediana | máx | pares com ABU>BVU em >5 p.p.")
for n,i in ours.items():
    L=[r for r in rows if r["id"]==i and r["o"]>0.005 and r["s"]+r["w"]>0]
    if not L: continue
    bvu=[r["g"]/r["o"] for r in L]; abu=[r["g"]/(r["s"]+r["w"]) for r in L]
    d=[abs(a-b) for a,b in zip(bvu,abu)]
    print("  %-11s %3d | %.2f | %.2f | %.3f | %.2f | %d"%(n,len(L),st.median(bvu),st.median(abu),st.median(d),max(d),sum(1 for a,b in zip(abu,bvu) if a-b>.05)))
# ranking por jogador (agregando por razão dos totais, peso 1): Spearman BVU x ABU
by=collections.defaultdict(lambda: collections.defaultdict(lambda:[0,0,0,0]))
for r in rows:
    if r["id"] in (1122,740):
        k=(r["id"],r["log"],r["pi"]); 
for n,i in (("Stability",1122),("Might",740)):
    acc=collections.defaultdict(lambda:[0,0,0])
    for r in rows:
        if r["id"]==i and r["o"]>0.005:
            k=(r["log"],r["pi"]); a=acc[k]; a[0]+=r["g"]; a[1]+=r["o"]; a[2]+=r["s"]+r["w"]
    bvu={k:v[0]/v[1] for k,v in acc.items()}; abu={k:v[0]/v[2] for k,v in acc.items()}
    ks=list(bvu); rb={k:j+1 for j,k in enumerate(sorted(ks,key=lambda k:-bvu[k]))}; ra={k:j+1 for j,k in enumerate(sorted(ks,key=lambda k:-abu[k]))}
    n_=len(ks); d2=sum((rb[k]-ra[k])**2 for k in ks)
    print("%s: %d linhas jogador/luta | Spearman do ranking BVU×ABU = %.3f"%(n,n_,1-6*d2/(n_*(n_*n_-1))))
