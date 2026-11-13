// JSON mínimo no formato do Elite Insights (WvW), com nomes fictícios.
const stat = (o: Record<string, number>) => [o];

const player = (o: {
  account: string;
  prof: string;
  guild: string;
  dmgEnemy: number;
  dmgNpc?: number;
  kills?: number;
  healing?: number;
  stab?: number;
  notInSquad?: boolean;
  commander?: boolean;
}) => ({
  account: o.account,
  name: o.account.split(".")[0] + " Char",
  profession: o.prof,
  guildID: o.guild,
  group: 1,
  hasCommanderTag: !!o.commander,
  notInSquad: !!o.notInSquad,
  friendlyNPC: false,
  isFake: false,
  activeTimes: [60000],
  // alvos: [0] jogador inimigo, [1] NPC (guarda)
  dpsTargets: [stat({ damage: o.dmgEnemy, powerDamage: o.dmgEnemy, condiDamage: 0 }), stat({ damage: o.dmgNpc ?? 0, powerDamage: o.dmgNpc ?? 0, condiDamage: 0 })],
  statsTargets: [stat({ killed: o.kills ?? 0, downed: o.kills ?? 0, downContribution: o.dmgEnemy / 2 }), stat({ killed: 0, downed: 0, downContribution: 0 })],
  dpsAll: stat({ damage: o.dmgEnemy + (o.dmgNpc ?? 0), powerDamage: o.dmgEnemy + (o.dmgNpc ?? 0), condiDamage: 0 }),
  statsAll: stat({ killed: o.kills ?? 0, downed: o.kills ?? 0, downContribution: 0, distToCom: 300, appliedCrowdControl: 2, interrupts: 1 }),
  defenses: stat({ damageTaken: 1000, damageBarrier: 50, deadCount: 0, downCount: 1, dodgeCount: 3, blockedCount: 2, evadedCount: 1 }),
  support: stat({ boonStrips: 4, condiCleanse: 5, condiCleanseSelf: 1, resurrects: 0, stunBreak: 1 }),
  extHealingStats: { outgoingHealing: stat({ healing: o.healing ?? 0 }) },
  extBarrierStats: { outgoingBarrier: stat({ barrier: 0 }) },
  squadBuffVolumes: [
    { id: 1122, buffVolumeData: [{ outgoing: o.stab ?? 0 }] },
    { id: 1187, buffVolumeData: [{ outgoing: 0 }] },
  ],
});

export const wvwFixture = () => ({
  eliteInsightsVersion: "3.32.0.0",
  triggerID: 1,
  fightName: "Detailed WvW - Eternal Battlegrounds",
  mapID: 38,
  timeStartStd: "2026-11-12 23:33:54 -03:00",
  durationMS: 60000,
  success: true,
  recordedAccountBy: "Comandante.1111",
  detailedWvW: true,
  wvWMapData: { redTeamID: 1 },
  targets: [{ name: "Inimigo", enemyPlayer: true }, { name: "Guard", enemyPlayer: false }],
  players: [
    player({ account: "Comandante.1111", prof: "Firebrand", guild: "GUILD-A", dmgEnemy: 20000, healing: 50000, stab: 3, commander: true }),
    player({ account: "Atacante.2222", prof: "Reaper", guild: "GUILD-A", dmgEnemy: 300000, dmgNpc: 999999, kills: 3 }),
    player({ account: "Outro.3333", prof: "Tempest", guild: "GUILD-B", dmgEnemy: 150000, kills: 1 }),
    player({ account: "Fora.4444", prof: "Scrapper", guild: "GUILD-C", dmgEnemy: 5000, notInSquad: true }),
  ],
});
