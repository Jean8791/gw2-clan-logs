import json,glob,os,urllib.request,collections,statistics as st,sys
OUT=os.environ.get("EI_OUT", "out").rstrip("/") + "/"
logs=sorted(glob.glob(OUT+"*.json"))
# 1. todas as habilidades usadas (rotação) nos logs
ids=set(); data={}
for f in logs:
    d=json.load(open(f)); data[f]=d
    for p in d["players"]:
        for r in p.get("rotation") or []:
            if r["id"]>0: ids.add(r["id"])
print("logs",len(logs),"| habilidades distintas na rotação:",len(ids))
# 2. fatos da API: quais habilidades aplicam cada boon
cache="/tmp/etapa5-skills.json"
skills=json.load(open(cache)) if os.path.exists(cache) else {}
need=[i for i in sorted(ids) if str(i) not in skills]
for k in range(0,len(need),150):
    chunk=need[k:k+150]
    try:
        with urllib.request.urlopen("https://api.guildwars2.com/v2/skills?v=latest&ids="+",".join(map(str,chunk)),timeout=30) as r:
            for s in json.load(r): skills[str(s["id"])]=s
    except Exception as e:
        print("erro API",e)
json.dump(skills,open(cache,"w"))
BOONS={"Stability":1122,"Quickness":1187,"Alacrity":30328,"Protection":717,"Aegis":743,"Resistance":26980,"Resolution":873,"Fury":725,"Might":740}
def applies(s):
    out=set()
    for fl in ("facts","traited_facts"):
        for f in s.get(fl) or []:
            if f.get("type")=="Buff" and f.get("status") in BOONS: out.add(f["status"])
    return out
byboon=collections.defaultdict(set)
for i,s in skills.items():
    for b in applies(s): byboon[b].add(int(i))
print("habilidades por boon que aparecem na rotação (fatos da API):",{b:len(v&ids) for b,v in byboon.items()})
print("habilidades da rotação encontradas na API:",sum(1 for i in ids if str(i) in skills),"de",len(ids))
# 3. protótipo: concentração dos usos de Stability, por jogador e luta
def window_max(ts,w):
    ts=sorted(ts); best=0; j=0
    for i in range(len(ts)):
        while ts[i]-ts[j]>w: j+=1
        best=max(best,i-j+1)
    return best
rows=[]
for f,d in data.items():
    for p in d["players"]:
        if p.get("notInSquad"): continue
        st_=[c["castTime"] for r in p.get("rotation") or [] if r["id"] in byboon["Stability"] for c in r["skills"]]
        gen=next((b["buffData"][0] for b in p.get("squadBuffs") or [] if b["id"]==1122),None)
        if len(st_)>=4 and gen and gen["generation"]+gen["wasted"]>0:
            abu=gen["generation"]/(gen["overstack"]+gen["wasted"])
            ts=sorted(st_); iv=[b-a for a,b in zip(ts,ts[1:])]
            rows.append(dict(n=len(ts),bc3=window_max(ts,3000)/len(ts),bc5=window_max(ts,5000)/len(ts),mi=st.median(iv)/1000,abu=abu,g=gen["generation"]))
print("\nPares jogador/luta com >=4 usos de habilidades de Stability e geração de Stab:",len(rows))
def corr(a,b):
    ma,mb=st.mean(a),st.mean(b); da=sum((x-ma)**2 for x in a); db=sum((y-mb)**2 for y in b)
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/((da*db)**.5) if da>0 and db>0 else float("nan")
if len(rows)>=5:
    for nome,k in (("concentração em 3 s (BC3)","bc3"),("concentração em 5 s (BC5)","bc5"),("intervalo mediano entre usos (s)","mi"),("nº de usos","n")):
        print("  correlação (Pearson) de %-34s com o ABU: %+.2f | com a geração: %+.2f"%(nome,corr([r[k] for r in rows],[r["abu"] for r in rows]),corr([r[k] for r in rows],[r["g"] for r in rows])))
    print("  BC3 mediana %.2f | BC5 mediana %.2f | intervalo mediano %.1fs | usos mediana %d"%(st.median(r["bc3"] for r in rows),st.median(r["bc5"] for r in rows),st.median(r["mi"] for r in rows),st.median(r["n"] for r in rows)))
