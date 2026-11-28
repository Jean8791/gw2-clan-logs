import json,glob,statistics as st
import os
OUT=os.environ.get("EI_OUT", "out").rstrip("/") + "/"
def html_data(f):
    s=open(f,encoding="utf8").read(); i=s.index("_logData = ")+len("_logData = ")
    d,_=json.JSONDecoder().raw_decode(s[i:]); return d
tot=0;ok=0;bad=[];vt=0;vok=0;vbad=[];kinds=set()
for jf in sorted(glob.glob(OUT+"*.json")):
    hf=jf.replace(".json",".html"); J=json.load(open(jf)); H=html_data(hf)
    ph=H["phases"][0]; gs=ph["buffsStatContainer"]; vs=ph["buffVolumesStatContainer"]
    hp=[p.get("acc") or p.get("name") for p in H["players"]]
    jp={ (p.get("account") or p.get("name")):p for p in J["players"]}
    # painel de geração squad: lista de ids = boons + sup (buffs de suporte) na ordem do HTML
    for gkey,vkey,idsk in [("boonGenSquadStats","boonOutgoingVolumeSquadStats","boons"),("supBuffGenSquadStats","supBuffOutgoingVolumeSquadStats","supBuffs")]:
        ids=[b if isinstance(b,int) else b.get("id") for b in H[idsk]]
        for pi,acc in enumerate(hp):
            p=jp.get(acc)
            if not p: continue
            sq={b["id"]:b["buffData"][0] for b in p.get("squadBuffs") or []}
            sv={b["id"]:b["buffVolumeData"][0] for b in p.get("squadBuffVolumes") or [] if b.get("buffVolumeData")}
            gdat=gs[gkey][pi]["data"]; vdat=vs[vkey][pi]["data"]
            for bi,i in enumerate(ids):
                row=gdat[bi] if bi<len(gdat) else None
                if row and i in sq:
                    tot+=1; kinds.add(len(row))
                    jd=sq[i]; exp=[jd["generation"],jd["overstack"],jd["wasted"]]
                    got=(row+[0,0,0])[:3]
                    if all(abs(a-b)<0.0015 for a,b in zip(got,exp)): ok+=1
                    else: bad.append((i,got,exp))
                vrow=vdat[bi] if bi<len(vdat) else None
                if vrow and i in sv:
                    vt+=1
                    if abs(vrow[0]-sv[i]["outgoing"])<0.0015: vok+=1
                    else: vbad.append((i,vrow,sv[i]))
print("HTML × JSON — geração Squad (generation, overstack, wasted):",ok,"de",tot,"coincidem | tamanhos de linha vistos:",sorted(kinds))
print("HTML × JSON — volume Squad (outgoing):",vok,"de",vt,"coincidem")
for b in bad[:4]: print("  diverge geração:",b)
for b in vbad[:4]: print("  diverge volume:",b)
