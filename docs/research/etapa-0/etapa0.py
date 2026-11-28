import json,glob,statistics as st,collections,re,sys
import os
OUT=os.environ.get("EI_OUT", "out").rstrip("/") + "/"
logs=sorted(glob.glob(OUT+"*.json"))
ours={1122:"Stability",740:"Might",1187:"Quickness",30328:"Alacrity",717:"Protection",743:"Aegis",26980:"Resistance",873:"Resolution",725:"Fury",5974:"Superspeed"}
rows=[]; act=[]; hits=collections.Counter()
big=collections.Counter(); logs_data={}
for f in logs:
    d=json.load(open(f)); logs_data[f]=d
    bm=d["buffMap"]
    for pi,p in enumerate(d["players"]):
        if p.get("notInSquad"): continue
        vol={b["id"]:b["buffVolumeData"][0] for b in p.get("squadBuffVolumes") or [] if b.get("buffVolumeData")}
        volA={b["id"]:b["buffVolumeData"][0] for b in p.get("squadBuffVolumesActive") or [] if b.get("buffVolumeData")}
        genA={b["id"]:b["buffData"][0] for b in p.get("squadBuffsActive") or [] if b.get("buffData")}
        for b in p.get("squadBuffs") or []:
            bd=b["buffData"][0]; i=b["id"]; v=vol.get(i)
            meta=bm.get("b%d"%i,{})
            name=meta.get("name","?"); stacking=bool(meta.get("stacking"))
            if v is None: hits["sem_volume"]+=1; continue
            r=dict(log=f[-30:-5],pi=pi,id=i,name=name,stk=stacking,g=bd["generation"],s=bd["overstack"],w=bd["wasted"],o=v["outgoing"],oe=v["outgoingByExtension"],
                   be=bd.get("byExtension",0),ex=bd.get("extended",0),ux=bd.get("unknownExtended",0),pr=bd.get("generationPresence",0))
            rows.append(r)
            if i in genA and i in volA:
                act.append(dict(name=name,g=bd["generation"],gA=genA[i]["generation"],o=v["outgoing"],oA=volA[i]["outgoing"],wA=genA[i]["wasted"],sA=genA[i]["overstack"]))
            if v["outgoing"]>1000: big[name]+=1
print("logs",len(logs),"| pares jogador/buff com squadBuffs e squadBuffVolumes:",len(rows),"| squadBuffs sem volume:",hits["sem_volume"])
act_pairs=len(act)
# A. overstack vs generation
dif=[r["s"]-r["g"] for r in rows]
print("overstack==generation:",sum(1 for x in dif if abs(x)<1e-9),"de",len(rows),"| overstack>generation:",sum(1 for x in dif if x>1e-9),"| overstack<generation:",sum(1 for x in dif if x<-1e-9))
if any(x>1e-9 for x in dif):
    ex=[r for r in rows if r["s"]-r["g"]>1e-9][:6]; print("  exemplos overstack>generation:",[(r["name"],r["g"],r["s"],r["w"],r["o"]) for r in ex])
# B. resíduo
def q(xs,p): xs=sorted(xs); return xs[min(len(xs)-1,int(p*len(xs)))] if xs else float("nan")
by=collections.defaultdict(list)
for r in rows:
    if r["o"]>0.005: by[r["name"]].append(r)
print("\nResíduo relativo (outgoing-(overstack+wasted))/outgoing, só outgoing>0,005. n | mediana | p10 | p90 | |res|<=1% | |res|>5% | tipo")
tab=[]
for n,lst in sorted(by.items(),key=lambda kv:-len(kv[1])):
    rel=[(r["o"]-(r["s"]+r["w"]))/r["o"] for r in lst]
    tab.append((n,len(lst),st.median(rel),q(rel,.1),q(rel,.9),sum(abs(x)<=.01 for x in rel)/len(rel),sum(abs(x)>.05 for x in rel)/len(rel),"pilha" if lst[0]["stk"] else "duração"))
for t in tab[:28]: print("  %-24s %4d | %+.3f | %+.3f | %+.3f | %3.0f%% | %3.0f%% | %s"%(t[0],t[1],t[2],t[3],t[4],t[5]*100,t[6]*100,t[7]))
allrel=[(r["o"]-(r["s"]+r["w"]))/r["o"] for r in rows if r["o"]>0.005]
print("  TODOS %d | mediana %+.4f | |res|<=1%%: %.1f%% | |res|<=5%%: %.1f%% | resíduo>0 (volume maior): %.1f%% | resíduo<0: %.1f%%"%(len(allrel),st.median(allrel),100*sum(abs(x)<=.01 for x in allrel)/len(allrel),100*sum(abs(x)<=.05 for x in allrel)/len(allrel),100*sum(x>.01 for x in allrel)/len(allrel),100*sum(x<-.01 for x in allrel)/len(allrel)))
# C. nossos 10 boons
print("\nOs 10 boons que o site guarda (volume 'outgoing'), n, mediana do resíduo, BVU=g/o mediana, p10, p90, g>o:")
for i,n in ours.items():
    lst=[r for r in rows if r["id"]==i and r["o"]>0.005]
    if not lst: print("  %-12s sem dados"%n); continue
    rel=[(r["o"]-(r["s"]+r["w"]))/r["o"] for r in lst]; bvu=[r["g"]/r["o"] for r in lst]
    print("  %-12s n=%3d | resíduo mediano %+.3f | BVU med %.2f p10 %.2f p90 %.2f | g>o: %d | wasted>0: %d"%(n,len(lst),st.median(rel),st.median(bvu),q(bvu,.1),q(bvu,.9),sum(r["g"]>r["o"]+1e-9 for r in lst),sum(r["w"]>0 for r in lst)))
# D. outliers
print("\nOutliers (|resíduo relativo|>5%), por buff (n_outliers/n):")
for n in ["Swiftness","Vampiric Aura","Last Rites","Regeneration","Vigor","Fury"]:
    lst=by.get(n,[]); out=[r for r in lst if abs((r["o"]-(r["s"]+r["w"]))/r["o"])>.05]
    if not lst: continue
    ratio=[r["o"]/(r["s"]+r["w"]) for r in lst if r["s"]+r["w"]>0]
    print("  %-14s %d/%d | razão outgoing/(overstack+wasted): mediana %.3f p10 %.3f p90 %.3f"%(n,len(out),len(lst),st.median(ratio),q(ratio,.1),q(ratio,.9)))
    for r in out[:3]: print("      g=%.3f s=%.3f w=%.3f o=%.3f oExt=%.3f byExt=%.3f ext=%.3f"%(r["g"],r["s"],r["w"],r["o"],r["oe"],r["be"],r["ex"]))
# E. extensões
print("\nExtensões: pares com byExtension>0:",sum(r["be"]>0 for r in rows),"| extended>0:",sum(r["ex"]>0 for r in rows),"| unknownExtended>0:",sum(r["ux"]>0 for r in rows),"| outgoingByExtension>0:",sum(r["oe"]>0 for r in rows))
# F. buffs enormes
print("Volumes >1000 (infinitos?):",dict(big))
# G. Active vs total
print("\nActive vs fase inteira (pares com os dois):",act_pairs)
if act:
    rg=[a["gA"]/a["g"] for a in act if a["g"]>0.005]; ro=[a["oA"]/a["o"] for a in act if a["o"]>0.005]
    print("  generation Active/total: mediana %.3f p10 %.3f p90 %.3f | outgoing Active/total: mediana %.3f p10 %.3f p90 %.3f"%(st.median(rg),q(rg,.1),q(rg,.9),st.median(ro),q(ro,.1),q(ro,.9)))
    mm=[abs(a["gA"]/a["g"]-a["oA"]/a["o"]) for a in act if a["g"]>0.005 and a["o"]>0.005]
    print("  |razão_geração − razão_volume| (denominadores Active diferentes se >0,02): mediana %.4f | >0,02: %.1f%%"%(st.median(mm),100*sum(x>.02 for x in mm)/len(mm)))
    ab=[a["gA"]/(a["gA"]+a["wA"]) for a in act if a["gA"]+a["wA"]>0.005]; bb=[r["g"]/(r["g"]+r["w"]) for r in rows if r["g"]+r["w"]>0.005]
    print("  BGU fase inteira: mediana %.3f | BGU Active: mediana %.3f"%(st.median(bb),st.median(ab)))
# H. escala por tipo
print("\nEscala (generation) por tipo, buffs principais:")
for i,n in ours.items():
    v=[r["g"] for r in rows if r["id"]==i]
    if v: print("  %-12s %s  min %.3f mediana %.3f p90 %.3f max %.3f"%(n,"pilha  " if next(r for r in rows if r['id']==i)['stk'] else "duração",min(v),st.median(v),q(v,.9),max(v)))
json.dump(rows,open("/tmp/etapa0-rows.json","w"))
