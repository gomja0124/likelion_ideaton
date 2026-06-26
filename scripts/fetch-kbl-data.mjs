import { writeFile } from "node:fs/promises";

const KBL_API = "https://api.kbl.or.kr";
const OUTPUT_FILE = new URL("../kbl-data.js", import.meta.url);
const FAVORITE_TEAM_CODE = "50";
const ACTIVE_STATUS = "A";
const PLAYER_POSITIONS = new Set(["GD", "FD", "C"]);

const requestHeaders = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Channel: "WEB",
  Pragma: "no-cache",
  Referer: "https://kbl.or.kr/",
  TeamCode: "XX",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  lang: "ko",
};

async function fetchJson(path) {
  const url = `${KBL_API}${path}`;
  const response = await fetch(url, { headers: requestHeaders });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

function normalizePlayer(player = {}) {
  return {
    pcode: player.pcode ?? "",
    name: player.pname ?? "",
    englishName: player.ename ?? "",
    teamCode: player.tcode ?? "",
    team: player.tname ?? "",
    teamEnglishName: player.tnameEn ?? "",
    backNumber: `${player.backNum ?? ""}`.trim(),
    position: player.pos ?? "",
    playerFlag: player.playerFlag ?? "",
    image: player.img ?? "",
    teamLogoClass: player.teamLogoClass ?? "",
    status: player.playerLastCareerIf ?? "",
  };
}

function normalizeLeaderRow(row = {}) {
  return {
    rank: row.rank ?? null,
    value: Number(row.value ?? 0),
    gameCount: Number(row.gameCount ?? 0),
    ...normalizePlayer(row.player),
  };
}

function normalizeStatsRow(row = {}) {
  return {
    player: normalizePlayer(row.player),
    records: row.records ?? {},
    gameCount: Number(row.gameCount ?? 0),
    startCount: Number(row.startCount ?? 0),
  };
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function isRosterPlayer(player) {
  return PLAYER_POSITIONS.has(player.position);
}

const [seasons, seasonLeaderRows, players] = await Promise.all([
  fetchJson("/season/list"),
  fetchJson("/league/season-leader"),
  fetchJson("/players"),
]);

const currentSeason =
  seasons.find(
    (season) =>
      season.seasonGrade === 1 &&
      season.seasonCategory === "R" &&
      season.gameCode === "01",
  ) ?? seasons[0];

const playerStatsRows = await fetchJson(
  `/leagues/${currentSeason.glkey}/stats/players`,
);

const allPlayers = players.map(normalizePlayer);
const activePlayers = allPlayers.filter((player) => player.status === ACTIVE_STATUS);
const activeRosterPlayers = activePlayers.filter(isRosterPlayer);
const favoriteTeamActive = activePlayers.filter(
  (player) => player.teamCode === FAVORITE_TEAM_CODE,
);
const favoriteTeamRosterPlayers = favoriteTeamActive.filter(isRosterPlayer);
const allPlayerStats = playerStatsRows.map(normalizeStatsRow);
const favoriteTeamStats = allPlayerStats.filter(
  (row) => row.player.teamCode === FAVORITE_TEAM_CODE,
);

const leaders = Object.fromEntries(
  seasonLeaderRows.map((section) => [
    section.part,
    {
      part: section.part,
      playerFlag: section.playerFlag,
      players: section.list.map(normalizeLeaderRow),
    },
  ]),
);

const payload = {
  source: {
    name: "KBL official public API",
    fetchedAt: new Date().toISOString(),
    channel: requestHeaders.Channel,
    teamCode: requestHeaders.TeamCode,
    endpoints: {
      seasons: `${KBL_API}/season/list`,
      seasonLeaders: `${KBL_API}/league/season-leader`,
      players: `${KBL_API}/players`,
      playerStats: `${KBL_API}/leagues/${currentSeason.glkey}/stats/players`,
    },
  },
  currentSeason,
  favoriteTeam: {
    code: FAVORITE_TEAM_CODE,
    name: "창원 LG",
    fullName: "창원 LG 세이커스",
    englishName: "Changwon LG Sakers",
    colors: {
      maroon: "#8a1538",
      maroonDark: "#3f0003",
      yellow: "#f5c542",
      white: "#ffffff",
    },
  },
  counts: {
    allPlayers: allPlayers.length,
    activePlayers: activePlayers.length,
    activeRosterPlayers: activeRosterPlayers.length,
    currentSeasonStats: allPlayerStats.length,
    favoriteTeamActive: favoriteTeamActive.length,
    favoriteTeamRosterPlayers: favoriteTeamRosterPlayers.length,
    favoriteTeamStats: favoriteTeamStats.length,
  },
  players: {
    all: allPlayers,
    active: activePlayers,
    favoriteTeamActive,
    favoriteTeamRosterPlayers,
    activeByTeamCount: countBy(activePlayers, (player) => player.teamCode),
    activeRosterByTeamCount: countBy(activeRosterPlayers, (player) => player.teamCode),
  },
  stats: {
    allPlayers: allPlayerStats,
    favoriteTeam: favoriteTeamStats,
    byTeamCount: countBy(allPlayerStats, (row) => row.player.teamCode),
  },
  leaders,
};

await writeFile(
  OUTPUT_FILE,
  `window.COURTLENS_KBL_DATA = ${JSON.stringify(payload, null, 2)};\n`,
);

console.log(
  [
    `Wrote ${OUTPUT_FILE.pathname}`,
    `season=${currentSeason.seasonName} (${currentSeason.glkey})`,
    `players=${payload.counts.allPlayers}`,
    `active=${payload.counts.activePlayers}`,
    `currentSeasonStats=${payload.counts.currentSeasonStats}`,
    `favoriteTeamRoster=${payload.counts.favoriteTeamRosterPlayers}`,
    `favoriteTeamStats=${payload.counts.favoriteTeamStats}`,
  ].join("\n"),
);
