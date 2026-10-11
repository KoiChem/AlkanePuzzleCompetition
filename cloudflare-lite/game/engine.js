// Pure sections extracted from ../AlkanePuzzle/index.html, commit f2e231b4db4bfae199ce06afdd44e8b4cf41cafe.
// Keep this module DOM-free. Each instance owns its RNG; concurrent rooms cannot affect each other.
export function createAlkaneEngine(random = Math.random) {
  const ROWS = 5, COLS = 7;
  // 生成中に配列をシャッフルしても方角の基準順を壊さないよう固定する。
  const DIR_ORDER = Object.freeze(['N', 'E', 'S', 'W']);
  const DIRECTION_BIT = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] }; // [drow, dcol]
  const VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };   // SVG上の[dx, dy]

  const PANEL_ARM_TABLE = { 1: ['E'], 2: ['N', 'S'], 3: ['N', 'E'], 4: ['N', 'W', 'E'], 5: ['N', 'E', 'S', 'W'] };
  const PANEL_LABELS = { 1: '末端', 2: '直線', 3: 'かど', 4: '分岐', 5: '四級' };
  // 練習モードでは主鎖を炭素35(ペンタトリアコンタン)まで組めるようにするため、35まで用意する。
  // 21以降は「1の位+10の位語幹」の組み合わせ方式に変わるため、個別の綴りを列挙している。
  const CHAIN_NAMES = [
    '', 'メタン', 'エタン', 'プロパン', 'ブタン', 'ペンタン', 'ヘキサン', 'ヘプタン', 'オクタン', 'ノナン', 'デカン',
    'ウンデカン', 'ドデカン', 'トリデカン', 'テトラデカン', 'ペンタデカン', 'ヘキサデカン', 'ヘプタデカン', 'オクタデカン', 'ノナデカン', 'イコサン',
    'ヘンイコサン', 'ドコサン', 'トリコサン', 'テトラコサン', 'ペンタコサン', 'ヘキサコサン', 'ヘプタコサン', 'オクタコサン', 'ノナコサン', 'トリアコンタン',
    'ヘントリアコンタン', 'ドトリアコンタン', 'トリトリアコンタン', 'テトラトリアコンタン', 'ペンタトリアコンタン',
  ];
  // 練習では、直鎖のアルキル基をペンタデシル基まで命名できる。
  // 分岐C3・C4側鎖は、学習でなじみのある慣用名で扱う。
  const STRAIGHT_ALKYL_NAMES = [
    '', 'メチル', 'エチル', 'プロピル', 'ブチル', 'ペンチル', 'ヘキシル', 'ヘプチル', 'オクチル', 'ノニル', 'デシル',
    'ウンデシル', 'ドデシル', 'トリデシル', 'テトラデシル', 'ペンタデシル',
  ];
  const SUBSTITUENT_NAME_BY_LENGTH = Object.fromEntries(
    STRAIGHT_ALKYL_NAMES.slice(1).map((name, index) => [index + 1, name])
  );
  // アルファベット順。慣用名では iso は数え、sec / tert は母体の butyl として扱う。
  // これは学習アプリで採る一般命名の約束であり、日本語の五十音順ではない。
  const SUBSTITUENT_ORDER = {
    'ブロモ': 0, 'ブチル': 1, 'sec-ブチル': 1.1, 'tert-ブチル': 1.2,
    'クロロ': 2, 'デシル': 3, 'ドデシル': 4, 'エチル': 5, 'フルオロ': 6,
    'ヘプチル': 7, 'ヘキシル': 8, 'ヨード': 9, 'イソブチル': 10, 'イソプロピル': 11,
    'メチル': 12, 'ノニル': 13, 'オクチル': 14, 'ペンタデシル': 15, 'ペンチル': 16,
    'プロピル': 17, 'テトラデシル': 18, 'トリデシル': 19, 'ウンデシル': 20,
  };
  function substituentOrder(name) { return SUBSTITUENT_ORDER[name] ?? Number.MAX_SAFE_INTEGER; }
  // index = 同じ置換基の個数。同一置換基を20個まで置いても倍数接頭語が付けられるようにする。
  const MULTIPLIER_PREFIX = [
    '', '', 'ジ', 'トリ', 'テトラ', 'ペンタ', 'ヘキサ', 'ヘプタ', 'オクタ', 'ノナ', 'デカ',
    'ウンデカ', 'ドデカ', 'トリデカ', 'テトラデカ', 'ペンタデカ', 'ヘキサデカ', 'ヘプタデカ', 'オクタデカ', 'ノナデカ', 'イコサ',
  ];
  // ハロゲン(F/Cl/Br/I): 一価の原子なので必ず1マス・末端(type1相当)になる
  const HALOGEN_INFO = {
    F: { name: 'フルオロ', stroke: '#B08D1A', fill: '#F7F2A0' },
    Cl: { name: 'クロロ', stroke: '#7CB518', fill: '#E8F5D0' },
    Br: { name: 'ブロモ', stroke: '#A0522D', fill: '#F3E0D6' },
    I: { name: 'ヨード', stroke: '#7B4397', fill: '#EBDFF5' },
  };
  const HYDROXYL_ELEMENT = 'OH';
  const HYDROXYL_FILL = '#E8564F';
  const HALOGEN_ELEMENT_BY_NAME = { 'フルオロ': 'F', 'クロロ': 'Cl', 'ブロモ': 'Br', 'ヨード': 'I' };
  // 出題(生成)で使う置換基の種類プールは、従来どおりエチルまでに固定する。
  // 練習の命名範囲とは意図的に別で、プロピル以上や分岐アルキル基は自動出題しない。
  const SUBSTITUENT_SPECIES = ['メチル', 'エチル', 'フルオロ', 'クロロ', 'ブロモ', 'ヨード'];
  const SUBSTITUENT_LENGTH = { 'メチル': 1, 'エチル': 2, 'フルオロ': 1, 'クロロ': 1, 'ブロモ': 1, 'ヨード': 1, [HYDROXYL_ELEMENT]: 1 };
  // 環は原子1個分の余白しか確保していないため、エチル(2マス必要)は対象外にする
  const RING_SUBSTITUENT_SPECIES = ['メチル', 'フルオロ', 'クロロ', 'ブロモ', 'ヨード'];

  function rotateCW(dir, times) {
    const steps = ((times % 4) + 4) % 4;
    const bit = DIRECTION_BIT[dir];
    const rotated = ((bit << steps) | (bit >> (4 - steps))) & 15;
    return DIR_ORDER.find((candidate) => DIRECTION_BIT[candidate] === rotated);
  }
  function getActiveDirections(panel) {
    const base = PANEL_ARM_TABLE[panel.type];
    const steps = (panel.rotation / 90) % 4;
    return new Set(base.map((d) => rotateCW(d, steps)));
  }
  function isHalogenPanel(panel) {
    return !!panel && !!panel.element && panel.element !== 'C';
  }
  // 炭素側から「このマスへ向かって」手を伸ばしている隣接方向の一覧を返す。
  // (隣が炭素で、その炭素の手がこちら側=OPPOSITE[dir]を向いているとき、その方向を含める)
  function incomingCarbonDirections(grid, r, c) {
    const dirs = [];
    for (const dir of DIR_ORDER) {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const neighbor = grid[nr][nc];
      if (!neighbor || isHalogenPanel(neighbor)) continue; // 炭素からの手だけを数える
      if (getActiveDirections(neighbor).has(OPPOSITE[dir])) dirs.push(dir);
    }
    return dirs;
  }
  // そのマスのパネルが実際に結合を形成している方向の集合を返す(グリッド全体の文脈が必要)。
  // ・炭素: 自身の手の向き(getActiveDirections)がそのまま結合方向。
  // ・ハロゲン: 向きを持たない一価原子。上下左右のうち「炭素の手がちょうど1方向だけ」来ているとき、
  //   その1方向へ自動で結合する。0方向、または2方向以上のときは結合しない(手を出さない)。
  function getBondDirections(grid, r, c) {
    const panel = grid[r][c];
    if (!panel) return new Set();
    if (isHalogenPanel(panel)) {
      const incoming = incomingCarbonDirections(grid, r, c);
      return incoming.length === 1 ? new Set(incoming) : new Set();
    }
    return getActiveDirections(panel);
  }
  function toBaseDir(actualDir, rotationDeg) {
    const steps = (rotationDeg / 90) % 4;
    return rotateCW(actualDir, (4 - steps) % 4);
  }

  // ============================================================
  // 命名エンジン(naming-engine.jsで検証済みのロジックと同一)
  // ============================================================
  function checkMismatches(grid) {
    const mismatches = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const panel = grid[r][c];
        if (!panel) continue;
        const bonds = getBondDirections(grid, r, c);
        for (const dir of bonds) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          const inBounds = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS;
          const neighbor = inBounds ? grid[nr][nc] : null;
          if (!neighbor) {
            mismatches.push({ r, c, dir, reason: 'DANGLING_BOND' });
            continue;
          }
          // 相手側も同じ結合を張り返しているか(ハロゲンの自動結合もこの1本の判定に含まれる)
          const neighborBonds = getBondDirections(grid, nr, nc);
          if (!neighborBonds.has(OPPOSITE[dir])) {
            mismatches.push({ r, c, dir, reason: 'ONE_SIDED_BOND' });
          }
        }
      }
    }
    return mismatches;
  }

  // SVGへ適用する数値の回転角から、実際に画面へ向く結合方向を独立に復元する。
  // getActiveDirections() と同じ方角表を経由しないため、方角表の誤変更で
  // 論理上だけ正しく見える状態を、出題前に検出できる。
  function physicalCarbonDirections(panel) {
    const baseMask = PANEL_ARM_TABLE[panel.type]
      .reduce((mask, dir) => mask | DIRECTION_BIT[dir], 0);
    const steps = (((panel.rotation / 90) % 4) + 4) % 4;
    const rotatedMask = ((baseMask << steps) | (baseMask >> (4 - steps))) & 15;
    return new Set(DIR_ORDER.filter((dir) => (rotatedMask & DIRECTION_BIT[dir]) !== 0));
  }

  function physicalBondDirections(grid, r, c) {
    const panel = grid[r][c];
    if (!panel) return new Set();
    if (!isHalogenPanel(panel)) return physicalCarbonDirections(panel);
    const incoming = [];
    for (const dir of DIR_ORDER) {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr, nc = c + dc;
      const neighbor = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS ? grid[nr][nc] : null;
      if (neighbor && !isHalogenPanel(neighbor) && physicalCarbonDirections(neighbor).has(OPPOSITE[dir])) incoming.push(dir);
    }
    return incoming.length === 1 ? new Set(incoming) : new Set();
  }

  // 隣接しているが結合していないパネルは許容する。ここで検査するのは、
  // 実際に結合線を出しているパネルの向きが相手の結合線と一致することだけ。
  function checkPhysicalPanelDirections(grid) {
    const mismatches = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c]) continue;
        for (const dir of physicalBondDirections(grid, r, c)) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          const neighbor = nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS ? grid[nr][nc] : null;
          if (!neighbor || !physicalBondDirections(grid, nr, nc).has(OPPOSITE[dir])) {
            mismatches.push({ r, c, dir });
          }
        }
      }
    }
    return mismatches;
  }

  function buildGraph(grid) {
    const adjacency = new Map();
    const nodeIds = [];
    const elements = new Map();
    const idOf = (r, c) => `${r},${c}`;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c]) {
          nodeIds.push(idOf(r, c));
          adjacency.set(idOf(r, c), new Set());
          elements.set(idOf(r, c), grid[r][c].element || 'C');
        }
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const panel = grid[r][c];
        if (!panel) continue;
        for (const dir of getBondDirections(grid, r, c)) {
          const [dr, dc] = DELTA[dir];
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || !grid[nr][nc]) continue;
          adjacency.get(idOf(r, c)).add(idOf(nr, nc));
          adjacency.get(idOf(nr, nc)).add(idOf(r, c));
        }
      }
    }
    return { nodeIds, adjacency, elements };
  }

  function checkConnectivity(graph) {
    const { nodeIds, adjacency } = graph;
    if (nodeIds.length === 0) return { allConnected: true, islands: [] };
    const visited = new Set([nodeIds[0]]);
    const queue = [nodeIds[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency.get(cur)) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    return { allConnected: visited.size === nodeIds.length, islands: nodeIds.filter((id) => !visited.has(id)) };
  }

  function countEdges(graph) {
    let sum = 0;
    for (const n of graph.adjacency.values()) sum += n.size;
    return sum / 2;
  }
  function classifyStructure(graph) {
    const V = graph.nodeIds.length, E = countEdges(graph);
    const cyclomatic = E - V + 1;
    if (cyclomatic === 0) return 'ALKANE';
    if (cyclomatic === 1) return 'CYCLOALKANE';
    return 'UNSUPPORTED_MULTI_RING';
  }

  function bfsDistancesAndParents(adjacency, start) {
    const dist = new Map([[start, 0]]);
    const parent = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency.get(cur)) {
        if (!dist.has(next)) { dist.set(next, dist.get(cur) + 1); parent.set(next, cur); queue.push(next); }
      }
    }
    return { dist, parent };
  }
  function reconstructPath(parent, from, to) {
    const path = [to];
    let cur = to;
    while (cur !== from) { cur = parent.get(cur); path.push(cur); }
    return path.reverse();
  }

  // 親鎖との結合を外した炭素側鎖を集める。分岐C3・C4は rooted tree の形から
  // 慣用名へ対応付け、直鎖はC15まで扱う。それより複雑な側鎖は従来どおり対象外にする。
  function nameCarbonSubstituent(graph, backboneSet, backboneNode, root) {
    const nodes = new Set();
    const queue = [{ id: root, parent: backboneNode }];
    while (queue.length) {
      const { id: cur, parent } = queue.shift();
      if (nodes.has(cur)) throw new Error('UNSUPPORTED_SUBSTITUENT');
      if (graph.elements.get(cur) !== 'C') throw new Error('UNSUPPORTED_SUBSTITUENT');
      nodes.add(cur);
      for (const next of graph.adjacency.get(cur)) {
        if (next === parent) continue;
        if (backboneSet.has(next)) throw new Error('UNSUPPORTED_SUBSTITUENT');
        if (nodes.has(next)) throw new Error('UNSUPPORTED_SUBSTITUENT');
        queue.push({ id: next, parent: cur });
      }
    }
    const carbonNeighbors = (id) => [...graph.adjacency.get(id)].filter((next) => nodes.has(next));
    const length = nodes.size;
    const rootDegree = carbonNeighbors(root).length;
    const isStraight = [...nodes].every((id) => carbonNeighbors(id).length <= 2);

    if (isStraight && rootDegree <= 1) {
      const name = SUBSTITUENT_NAME_BY_LENGTH[length];
      if (!name) throw new Error('UNSUPPORTED_SUBSTITUENT');
      return { backboneNode, length, name };
    }
    if (isStraight && length === 3 && rootDegree === 2) {
      return { backboneNode, length, name: 'イソプロピル' };
    }
    if (isStraight && length === 4 && rootDegree === 2) {
      return { backboneNode, length, name: 'sec-ブチル' };
    }
    if (length === 4 && rootDegree === 1) {
      const junction = carbonNeighbors(root)[0];
      if (junction && carbonNeighbors(junction).length === 3) {
        return { backboneNode, length, name: 'イソブチル' };
      }
    }
    if (length === 4 && rootDegree === 3 && [...nodes].every((id) => id === root || carbonNeighbors(id).length === 1)) {
      return { backboneNode, length, name: 'tert-ブチル' };
    }
    throw new Error('UNSUPPORTED_SUBSTITUENT');
  }

  function extractSubstituents(graph, backboneSet) {
    const substituents = [];
    for (const node of backboneSet) {
      for (const neighbor of graph.adjacency.get(node)) {
        if (backboneSet.has(neighbor)) continue;

        const neighborElement = graph.elements.get(neighbor);
        if (neighborElement !== 'C') {
          if (neighborElement === HYDROXYL_ELEMENT) continue; // OHは主官能基として別途集計する
          // ハロゲンは一価なので、この1マスで置換基が確定する(さらに先に何か繋がっていたら不正な構造)
          const further = [...graph.adjacency.get(neighbor)].filter((n) => n !== node);
          if (further.length > 0) throw new Error('UNSUPPORTED_SUBSTITUENT');
          substituents.push({ backboneNode: node, length: 1, name: HALOGEN_INFO[neighborElement].name });
          continue;
        }

        substituents.push(nameCarbonSubstituent(graph, backboneSet, node, neighbor));
      }
    }
    return substituents;
  }

  function hydroxylLocants(graph, orderedBackbone) {
    const backboneSet = new Set(orderedBackbone);
    const locants = [];
    for (const node of orderedBackbone) {
      for (const neighbor of graph.adjacency.get(node)) {
        if (graph.elements.get(neighbor) === HYDROXYL_ELEMENT) {
          if (graph.adjacency.get(neighbor).size !== 1) throw new Error('INVALID_HYDROXYL');
          locants.push(orderedBackbone.indexOf(node) + 1);
        }
      }
    }
    // 親構造外のOHを「ヒドロキシ置換基」としては扱わない。ベータでは主鎖・主環に
    // すべてのOHが載る構造だけを命名対象とし、生成器もその条件を満たすものを選ぶ。
    const allHydroxyls = graph.nodeIds.filter((id) => graph.elements.get(id) === HYDROXYL_ELEMENT);
    if (locants.length !== allHydroxyls.length || new Set(locants).size !== locants.length) {
      throw new Error('UNSUPPORTED_HYDROXYL_LAYOUT');
    }
    return locants.sort((a, b) => a - b);
  }

  function validateHydroxyls(graph) {
    for (const id of graph.nodeIds) {
      if (graph.elements.get(id) !== HYDROXYL_ELEMENT) continue;
      const neighbors = [...graph.adjacency.get(id)];
      if (neighbors.length !== 1 || graph.elements.get(neighbors[0]) !== 'C') throw new Error('INVALID_HYDROXYL');
    }
    for (const id of graph.nodeIds) {
      if (graph.elements.get(id) !== 'C') continue;
      const hydroxylCount = [...graph.adjacency.get(id)].filter((n) => graph.elements.get(n) === HYDROXYL_ELEMENT).length;
      if (hydroxylCount > 1) throw new Error('GEMINAL_DIOL');
    }
  }

  // IUPACでは、同種の原子だけからなる2炭素鎖の単置換体は位置番号「1」を省略する。
  // 例: フルオロエタン、クロロエタン（ただし 1,1-ジクロロエタン等では省略しない）。
  function buildSubstituentPrefix(locantedSubstituents, omitSoleEthaneLocant = false) {
    if (locantedSubstituents.length === 0) return '';
    if (omitSoleEthaneLocant && locantedSubstituents.length === 1 && locantedSubstituents[0].locant === 1) {
      return locantedSubstituents[0].name;
    }
    const groups = new Map();
    for (const s of locantedSubstituents) {
      if (!groups.has(s.name)) groups.set(s.name, []);
      groups.get(s.name).push(s.locant);
    }
    const sortedNames = [...groups.keys()].sort((a, b) => substituentOrder(a) - substituentOrder(b));
    return sortedNames.map((name) => {
      const locants = groups.get(name).sort((a, b) => a - b);
      return `${locants.join(',')}-${MULTIPLIER_PREFIX[locants.length] || ''}${name}`;
    }).join('-');
  }

  // メタンを親構造にする場合、炭素は1個だけなので置換基の位置番号「1」は書かない。
  function buildMethaneSubstituentPrefix(substituents) {
    if (substituents.length === 0) return '';
    const counts = new Map();
    for (const s of substituents) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    return [...counts.keys()]
      .sort((a, b) => substituentOrder(a) - substituentOrder(b))
      .map((name) => `${MULTIPLIER_PREFIX[counts.get(name)] || ''}${name}`)
      .join('');
  }

  function buildAlcoholName(parentName, hydroxylLocantList, locantedSubstituents, isCyclo) {
    const prefix = parentName === 'メタン'
      ? buildMethaneSubstituentPrefix(locantedSubstituents)
      : buildSubstituentPrefix(locantedSubstituents);
    const count = hydroxylLocantList.length;
    if (count === 0) return prefix + parentName;
    const alcoholStem = parentName.endsWith('ン') ? parentName.slice(0, -1) + 'ノール' : parentName + 'オール';
    if (count === 1) {
      const omitLocant = isCyclo || parentName === 'メタン' || parentName === 'エタン';
      const alcoholPart = omitLocant ? alcoholStem : `${hydroxylLocantList[0]}-${alcoholStem}`;
      return prefix ? (omitLocant ? prefix + alcoholPart : `${prefix}-${alcoholPart}`) : alcoholPart;
    }
    const alcoholPart = `${hydroxylLocantList.join(',')}-${parentName}${MULTIPLIER_PREFIX[count]}オール`;
    return prefix ? `${prefix}-${alcoholPart}` : alcoholPart;
  }

  function buildName(baseName, locantedSubstituents) {
    return buildSubstituentPrefix(locantedSubstituents, baseName === 'エタン') + baseName;
  }

  function compareLocantArrays(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? Infinity, bv = b[i] ?? Infinity;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // 置換基をアルファベット順(同名なら位置番号順)に並べたときの、位置番号だけの配列を作る。
  // 「位置番号の組み合わせ」が同点の候補同士を比べるときのタイブレークに使う
  // (IUPACの規則: 同点なら、アルファベット順で先に来る置換基により小さい番号を与える)。
  function alphabeticalLocants(rawSubstituents, locantOf) {
    return rawSubstituents
      .map((s) => ({ order: substituentOrder(s.name), locant: locantOf(s) }))
      .sort((a, b) => (a.order - b.order) || (a.locant - b.locant))
      .map((x) => x.locant);
  }

  // 番号の付け方の候補を2段階で比較する。
  // ①位置番号の組み合わせ全体(小さい方が優先)。②それが同点なら、アルファベット順で先に来る
  // 置換基がより小さい番号になっている方を優先する。
  function compareNumberingCandidates(a, b) {
    const bySet = compareLocantArrays(a.locants, b.locants);
    if (bySet !== 0) return bySet;
    return compareLocantArrays(a.alphaLocants, b.alphaLocants);
  }

  // メタン置換体(炭素が1個だけの構造)専用の名前組み立て。
  // 炭素が1個しかなく位置番号に意味がないため、位置番号(ロカント)を付けずに置換基名を連結する。
  // 例: クロロメタン、ジクロロメタン、トリクロロメタン、テトラクロロメタン、クロロフルオロメタン
  function buildMethaneName(substituents) {
    if (substituents.length === 0) return 'メタン'; // 通常は不整合チェックの時点で弾かれるためここには来ない
    const counts = new Map();
    for (const s of substituents) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    const sortedNames = [...counts.keys()].sort((a, b) => substituentOrder(a) - substituentOrder(b));
    const parts = sortedNames.map((name) => {
      const count = counts.get(name);
      const multiplier = MULTIPLIER_PREFIX[count] || '';
      return `${multiplier}${name}`;
    });
    return parts.join('') + 'メタン';
  }

  function nameAlkane(graph) {
    const { nodeIds, adjacency, elements } = graph;
    const carbonIds = nodeIds.filter((id) => elements.get(id) === 'C');

    // 主鎖の炭素が1個だけの場合(ハロゲン化メタン): 2端点間の最長パス探索がそもそも成立しない特殊ケースなので専用に処理する
    if (carbonIds.length === 1) {
      const centerId = carbonIds[0];
      const rawSubstituents = extractSubstituents(graph, new Set([centerId]));
      const hydroxyls = hydroxylLocants(graph, [centerId]);
      if (hydroxyls.length) return buildAlcoholName('メタン', hydroxyls, rawSubstituents.map((s) => ({ locant: 1, name: s.name })), false);
      return buildMethaneName(rawSubstituents);
    }

    // 主鎖の候補端点は炭素のみに限定する(ハロゲンは一価の置換基であり、主鎖の一部にはなれない)。
    // 末端炭素にハロゲンが付いている場合でも正しく端点として扱えるよう、
    // 「全結合数」ではなく「炭素どうしの結合数」が1かどうかで判定する。
    const leaves = carbonIds.filter((id) => {
      let carbonNeighborCount = 0;
      for (const n of adjacency.get(id)) if (elements.get(n) === 'C') carbonNeighborCount++;
      return carbonNeighborCount === 1;
    });
    const distMaps = new Map();
    for (const leaf of leaves) distMaps.set(leaf, bfsDistancesAndParents(adjacency, leaf));

    const candidatePairs = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const d = distMaps.get(leaves[i]).dist.get(leaves[j]);
        if (Number.isFinite(d)) candidatePairs.push([leaves[i], leaves[j]]);
      }
    }

    // 主鎖は「OHを最も多く含む」→「最も長い」の順で、構造そのものから先に決める。
    // 命名できない側鎖を持つ最長鎖候補を捨てて、短い鎖へ後退すると、
    // 3-プロピルヘキサンのような最長鎖規則に反する名前を作ってしまう。
    // そこで命名可能性は主鎖候補の優先順位を変えないものとし、最上位候補だけを命名する。
    const structuralCandidates = candidatePairs.flatMap(([a, b]) => {
      const path = reconstructPath(distMaps.get(a).parent, a, b);
      const hydroxylCount = path.reduce((count, node) => count + [...adjacency.get(node)]
        .filter((neighbor) => elements.get(neighbor) === HYDROXYL_ELEMENT).length, 0);
      return [path, [...path].reverse()].map((orderedPath) => ({ orderedPath, hydroxylCount }));
    });
    const maxHydroxylCount = Math.max(...structuralCandidates.map((candidate) => candidate.hydroxylCount));
    const maxParentLength = Math.max(...structuralCandidates
      .filter((candidate) => candidate.hydroxylCount === maxHydroxylCount)
      .map((candidate) => candidate.orderedPath.length));

    let best = null;
    const candidateErrors = new Set();
    for (const { orderedPath, hydroxylCount } of structuralCandidates) {
      if (hydroxylCount !== maxHydroxylCount || orderedPath.length !== maxParentLength) continue;
      if (orderedPath.length > 35) throw new Error('UNSUPPORTED: 主鎖がペンタトリアコンタンを超えています');
      const pathSet = new Set(orderedPath);
      try {
        const rawSubstituents = extractSubstituents(graph, pathSet);
        const hydroxyls = hydroxylLocants(graph, orderedPath);
        const locantOf = (s) => orderedPath.indexOf(s.backboneNode) + 1;
        const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
        const alphaLocants = alphabeticalLocants(rawSubstituents, locantOf);
        const branchCount = rawSubstituents.length;
        const candidate = { orderedPath, rawSubstituents, hydroxyls, locants, alphaLocants, branchCount };
        if (best === null
          || compareLocantArrays(candidate.hydroxyls, best.hydroxyls) < 0
          || (compareLocantArrays(candidate.hydroxyls, best.hydroxyls) === 0 && candidate.branchCount > best.branchCount)
          || (compareLocantArrays(candidate.hydroxyls, best.hydroxyls) === 0 && candidate.branchCount === best.branchCount && compareNumberingCandidates(candidate, best) < 0)) best = candidate;
      } catch (e) {
        // 最優先の主鎖だけを試したうえで理由を返す。短い主鎖への後退はしない。
        candidateErrors.add(e.message);
      }
    }
    if (!best) {
      if (candidateErrors.has('UNSUPPORTED_SUBSTITUENT')) throw new Error('UNSUPPORTED_SUBSTITUENT');
      if (candidateErrors.has('UNSUPPORTED_HYDROXYL_LAYOUT')) throw new Error('UNSUPPORTED_HYDROXYL_LAYOUT');
      throw new Error('UNSUPPORTED_SUBSTITUENT');
    }
    const locantedSubstituents = best.rawSubstituents.map((s) => ({ locant: best.orderedPath.indexOf(s.backboneNode) + 1, name: s.name }));
    if (best.hydroxyls.length) return buildAlcoholName(CHAIN_NAMES[best.orderedPath.length], best.hydroxyls, locantedSubstituents, false);
    return buildName(CHAIN_NAMES[best.orderedPath.length], locantedSubstituents);
  }

  function findRing(graph) {
    const { nodeIds, adjacency } = graph;
    const visited = new Set();
    const parent = new Map();
    const stack = [[nodeIds[0], null]];
    while (stack.length) {
      const [node, from] = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node); parent.set(node, from);
      for (const next of adjacency.get(node)) {
        if (next === from) continue;
        if (visited.has(next)) {
          const ring = [node];
          let cur = node;
          while (cur !== next) { cur = parent.get(cur); ring.push(cur); }
          return ring;
        }
        stack.push([next, node]);
      }
    }
    throw new Error('RING_NOT_FOUND');
  }

  function nameCycloalkane(graph) {
    const ring = findRing(graph);
    const ringSize = ring.length;
    if (ringSize % 2 !== 0) throw new Error('UNSUPPORTED: 奇数員環');
    if (ringSize < 4 || ringSize > 34) throw new Error(`UNSUPPORTED: シクロ${ringSize}員環は対象外`);

    const ringSet = new Set(ring);
    const rawSubstituents = extractSubstituents(graph, ringSet);
    const hydroxylCount = graph.nodeIds.filter((id) => graph.elements.get(id) === HYDROXYL_ELEMENT).length;
    const parentName = 'シクロ' + CHAIN_NAMES[ringSize];
    if (hydroxylCount > 0) {
      let bestAlcohol = null;
      for (let startIdx = 0; startIdx < ringSize; startIdx++) {
        for (const direction of [1, -1]) {
          const ordered = [];
          for (let step = 0; step < ringSize; step++) ordered.push(ring[((startIdx + step * direction) % ringSize + ringSize) % ringSize]);
          try {
            const hydroxyls = hydroxylLocants(graph, ordered);
            const locantOf = (s) => ordered.indexOf(s.backboneNode) + 1;
            const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
            const candidate = { ordered, hydroxyls, locants, alphaLocants: alphabeticalLocants(rawSubstituents, locantOf) };
            if (bestAlcohol === null
              || compareLocantArrays(candidate.hydroxyls, bestAlcohol.hydroxyls) < 0
              || (compareLocantArrays(candidate.hydroxyls, bestAlcohol.hydroxyls) === 0 && compareNumberingCandidates(candidate, bestAlcohol) < 0)) bestAlcohol = candidate;
          } catch (e) { /* 主環外のOHを持つ候補は除外 */ }
        }
      }
      if (!bestAlcohol) throw new Error('UNSUPPORTED_HYDROXYL_LAYOUT');
      const locantedSubstituents = rawSubstituents.map((s) => ({ locant: bestAlcohol.ordered.indexOf(s.backboneNode) + 1, name: s.name }));
      return buildAlcoholName(parentName, bestAlcohol.hydroxyls, locantedSubstituents, true);
    }
    if (rawSubstituents.length === 0) return 'シクロ' + CHAIN_NAMES[ringSize];

    // 環の置換基が1個だけなら、どこを1番炭素にしても位置番号は必ず1になり情報を持たないため省略する
    // (例: 1-メチルシクロヘキサン ではなく メチルシクロヘキサン)
    if (rawSubstituents.length === 1) {
      return rawSubstituents[0].name + 'シクロ' + CHAIN_NAMES[ringSize];
    }

    let best = null;
    for (let startIdx = 0; startIdx < ringSize; startIdx++) {
      for (const direction of [1, -1]) {
        const ordered = [];
        for (let step = 0; step < ringSize; step++) {
          const idx = ((startIdx + step * direction) % ringSize + ringSize) % ringSize;
          ordered.push(ring[idx]);
        }
        const locantOf = (s) => ordered.indexOf(s.backboneNode) + 1;
        const locants = rawSubstituents.map(locantOf).sort((a, b) => a - b);
        const alphaLocants = alphabeticalLocants(rawSubstituents, locantOf);
        const candidate = { ordered, locants, alphaLocants };
        if (best === null || compareNumberingCandidates(candidate, best) < 0) best = candidate;
      }
    }
    const locantedSubstituents = rawSubstituents.map((s) => ({ locant: best.ordered.indexOf(s.backboneNode) + 1, name: s.name }));
    return buildName('シクロ' + CHAIN_NAMES[ringSize], locantedSubstituents);
  }

  function generateName(grid) {
    const mismatches = checkMismatches(grid);
    if (mismatches.length > 0) return { ok: false, error: 'INCOMPLETE_BONDS', mismatches };
    const graph = buildGraph(grid);
    if (graph.nodeIds.length === 0) return { ok: false, error: 'EMPTY_GRID' };
    const connectivity = checkConnectivity(graph);
    if (!connectivity.allConnected) return { ok: false, error: 'DISCONNECTED', islands: connectivity.islands };
    const structureType = classifyStructure(graph);
    try {
      validateHydroxyls(graph);
      if (structureType === 'ALKANE') return { ok: true, name: nameAlkane(graph) };
      if (structureType === 'CYCLOALKANE') return { ok: true, name: nameCycloalkane(graph) };
      return { ok: false, error: structureType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // 結合としては正常だが、この学習アプリの命名範囲外であるエラーを分けて扱う。
  function randInt(min, max) { return min + Math.floor(random() * (max - min + 1)); }
  function choice(arr) { return arr[randInt(0, arr.length - 1)]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function emptyGrid() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
  function pickUpToNDistinct(pool, n) {
    const count = randInt(1, Math.max(1, Math.min(n, pool.length)));
    const shuffled = shuffle([...pool]);
    return shuffled.slice(0, count);
  }
  // 「置換基・OH基の種類数」の範囲([min,max])に従って、実際に使う種類を選ぶ。
  // 空きスロット数より多くの種類は使えないので、そこでも頭打ちにする。
  function pickSpeciesForRange(typeRange, slotCount, forceHydroxyl = false) {
    const [rawMin, rawMax] = Array.isArray(typeRange) ? typeRange : [1, typeRange || 1];
    const pool = forceHydroxyl ? [...SUBSTITUENT_SPECIES, HYDROXYL_ELEMENT] : SUBSTITUENT_SPECIES;
    const hi = Math.max(1, Math.min(rawMax, pool.length, Math.max(1, slotCount)));
    const lo = Math.max(1, Math.min(rawMin, hi));
    const count = randInt(lo, hi);
    // アルコール問題ではOHを「置換基・OH基の種類数」の1つとして必ず選ぶ。
    // 残りの種類は従来どおり他の置換基から選ぶため、OHだけを重み付けして
    // 多価アルコールが不意に増えすぎることを避けられる。
    if (forceHydroxyl) {
      return [HYDROXYL_ELEMENT, ...shuffle([...SUBSTITUENT_SPECIES]).slice(0, count - 1)];
    }
    return shuffle([...pool]).slice(0, count);
  }

  // targetDirsが欲しいときに、その活性方向の組を実現するtype/rotationを逆算する
  // (手計算で回転角を出すよりも間違いにくいので、生成ロジックは基本これ経由にする)
  function panelFor(type, targetDirs) {
    const targetSet = new Set(targetDirs);
    const base = PANEL_ARM_TABLE[type];
    for (let steps = 0; steps < 4; steps++) {
      const candidate = new Set(base.map((d) => rotateCW(d, steps)));
      if (candidate.size === targetSet.size && [...candidate].every((d) => targetSet.has(d))) {
        return { type, rotation: steps * 90 };
      }
    }
    throw new Error('NO_ROTATION_MATCH'); // 生成ロジックのバグ(本来到達しないはず)
  }

  function spinePanel(hasUp, hasDown, isLeftEnd, isRightEnd) {
    // 末端も側鎖の付く位置として使える。主鎖方向と上下の側鎖方向をまとめて
    // パネル化すれば、末端のハロゲン化・アルコール化も結合線どおりに生成できる。
    const chainDirs = isLeftEnd ? ['E'] : isRightEnd ? ['W'] : ['W', 'E'];
    const dirs = chainDirs.concat(hasUp ? ['N'] : [], hasDown ? ['S'] : []);
    return panelForDirections(dirs);
  }

  // 置換基の名前(メチル/エチル/フルオロ/クロロ/ブロモ/ヨード)から、その枝を構成するパネル列を作る
  function branchPanelsForName(side, name) {
    const back = side === 'up' ? 'S' : 'N';
    const fwd = side === 'up' ? 'N' : 'S';
    const length = SUBSTITUENT_LENGTH[name];
    if (length === 1) {
      const panel = panelFor(1, [back]);
      if (name === HYDROXYL_ELEMENT) panel.element = HYDROXYL_ELEMENT;
      const el = HALOGEN_ELEMENT_BY_NAME[name];
      if (el) panel.element = el;
      return [panel];
    }
    return [panelFor(2, [back, fwd]), panelFor(1, [back])];
  }

  // 鎖状(アルカン): 横一直線の主鎖 + 上下に伸びる置換基、という単純なレイアウトで生成する(かんたんモード用)。
  // 5行×7列に収めるため主鎖は最大7炭素までとする(命名エンジン自体は10炭素まで対応可能)。
  function generateAlkaneGrid(typeRange, opts) {
    const { lenMin = 2, lenMax = 7, subMin = 0, subMax = 3, forceHydroxyl = false, hydroxylLimitOne = false } = opts || {};
    const len = randInt(Math.max(2, lenMin), Math.max(2, lenMax));
    const startCol = Math.floor((COLS - len) / 2);
    const spineRow = 2;
    const grid = emptyGrid();

    const slots = [];
    // 直線レイアウトでも末端を候補から外さない。上下2方向ずつを用意するので、
    // 位置ごとの候補数は主鎖の内外で等しく、末端専用の出題率にはならない。
    for (let i = 0; i < len; i++) { slots.push([i, 'up']); slots.push([i, 'down']); }
    shuffle(slots);

    const distinctNames = pickSpeciesForRange(typeRange, slots.length, forceHydroxyl);

    const count = Math.min(slots.length, randInt(subMin, subMax));
    const posInfo = {};
    let hydroxylCount = 0;
    for (let i = 0; i < count; i++) {
      const [idx, side] = slots[i];
      if (!posInfo[idx]) posInfo[idx] = {};
      const candidates = distinctNames.filter((name) => name !== HYDROXYL_ELEMENT
        || (!Object.values(posInfo[idx]).includes(HYDROXYL_ELEMENT) && (!hydroxylLimitOne || hydroxylCount === 0)));
      if (candidates.length === 0) continue; // 同じ炭素へのOH重複(ジェミナルジオール)を避ける
      const name = candidates.length === 1 ? candidates[0] : choice(candidates);
      posInfo[idx][side] = name;
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
    }

    for (let i = 0; i < len; i++) {
      const col = startCol + i;
      const info = posInfo[i] || {};
      grid[spineRow][col] = spinePanel(!!info.up, !!info.down, i === 0, i === len - 1);
      if (info.up) {
        const bp = branchPanelsForName('up', info.up);
        grid[spineRow - 1][col] = bp[0];
        if (bp[1]) grid[spineRow - 2][col] = bp[1];
      }
      if (info.down) {
        const bp = branchPanelsForName('down', info.down);
        grid[spineRow + 1][col] = bp[0];
        if (bp[1]) grid[spineRow + 2][col] = bp[1];
      }
    }
    return grid;
  }

  // ---- 屈曲する主鎖(難問モード用) ----
  // 直線ではなく、グリッド上をランダムウォークさせて主鎖を作る。自己交差はしない。
  function directionBetween([r1, c1], [r2, c2]) {
    if (r2 === r1 - 1 && c2 === c1) return 'N';
    if (r2 === r1 + 1 && c2 === c1) return 'S';
    if (r2 === r1 && c2 === c1 + 1) return 'E';
    if (r2 === r1 && c2 === c1 - 1) return 'W';
    throw new Error('NOT_ADJACENT');
  }

  function computeChainDirs(path, i) {
    const dirs = [];
    if (i > 0) dirs.push(directionBetween(path[i], path[i - 1]));
    if (i < path.length - 1) dirs.push(directionBetween(path[i], path[i + 1]));
    return dirs;
  }

  // 主鎖のうち「進む向きが変わる炭素(かど)」の数を数える(折れ曲がり炭素の数の判定に使う)
  function countBends(path) {
    let bends = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const [dPrev, dNext] = computeChainDirs(path, i);
      if (OPPOSITE[dPrev] !== dNext) bends++;
    }
    return bends;
  }

  // 活性方向の集合から自動でパネル種類を判定して生成する(手動でtypeを指定しなくてよい版)
  function panelForDirections(dirs) {
    const set = new Set(dirs);
    const n = set.size;
    if (n === 1) return panelFor(1, [...set]);
    if (n === 2) {
      const [a, b] = [...set];
      return panelFor(OPPOSITE[a] === b ? 2 : 3, [...set]);
    }
    if (n === 3) return panelFor(4, [...set]);
    if (n === 4) return panelFor(5, [...set]);
    throw new Error('INVALID_DIRECTION_COUNT');
  }

  function tryGenerateBentChain(len, forceTurn) {
    const occupied = new Set();
    const key = (r, c) => `${r},${c}`;
    let r = randInt(1, ROWS - 2);
    let c = randInt(2, COLS - 3);
    const path = [[r, c]];
    occupied.add(key(r, c));
    let lastDir = null;

    for (let step = 1; step < len; step++) {
      let candidates = shuffle(['N', 'E', 'S', 'W']).filter((d) => !lastDir || d !== OPPOSITE[lastDir]);
      if (forceTurn && lastDir) {
        // 直進(lastDirと同じ向き)を優先度最後に回し、できるだけ曲がらせる
        candidates = candidates.filter((d) => d !== lastDir).concat(candidates.filter((d) => d === lastDir));
      }
      let moved = false;
      for (const d of candidates) {
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || occupied.has(key(nr, nc))) continue;
        r = nr; c = nc;
        path.push([r, c]);
        occupied.add(key(r, c));
        lastDir = d;
        moved = true;
        break;
      }
      if (!moved) return null; // 行き詰まったら失敗(呼び出し元でリトライ)
    }
    return { path, occupied };
  }

  function planBentSubstituents(path, occupied, typeRange, subMin, subMax, forceHydroxyl, hydroxylLimitOne) {
    const len = path.length;
    // まず「方向」ではなく主鎖上の「炭素位置」を均等に選ぶ。
    // 末端は3方向、内部は2方向空くため、方向をそのまま抽選すると末端だけが
    // 1.5倍選ばれてしまう。位置を先に抽選し、空き方向はその後で決める。
    // 同じ炭素も空き原子価がある間は候補に残すので、1,1,1-トリクロロ体のような
    // 多置換も、末端専用の特例なしに生成できる。
    const distinctNames = pickSpeciesForRange(typeRange, len * 3, forceHydroxyl);
    const targetCount = randInt(subMin, subMax);
    const posInfo = {};
    let placed = 0;
    let hydroxylCount = 0;
    const place = (i, dir, name) => {
      const length = SUBSTITUENT_LENGTH[name];
      const [dr, dc] = DELTA[dir];
      const [r0, c0] = path[i];
      let rr = r0, cc = c0;
      for (let k = 0; k < length; k++) {
        rr += dr; cc += dc;
        occupied.add(`${rr},${cc}`);
      }
      if (!posInfo[i]) posInfo[i] = {};
      posInfo[i][dir] = name;
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
      placed++;
    };
    const canPlace = (i, dir, name) => {
      const length = SUBSTITUENT_LENGTH[name];
      const [dr, dc] = DELTA[dir];
      const [r0, c0] = path[i];
      let rr = r0, cc = c0;
      for (let k = 0; k < length; k++) {
        rr += dr; cc += dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || occupied.has(`${rr},${cc}`)) return false;
      }
      return true;
    };
    const eligibleNamesAt = (i) => {
      const currentNames = posInfo[i] ? Object.values(posInfo[i]) : [];
      return distinctNames.filter((name) => name !== HYDROXYL_ELEMENT
        || (!currentNames.includes(HYDROXYL_ELEMENT) && (!hydroxylLimitOne || hydroxylCount === 0)));
    };
    const choicesAt = (i, names) => {
      const chainDirs = computeChainDirs(path, i);
      const usedDirs = new Set(Object.keys(posInfo[i] || {}));
      const directions = DIR_ORDER.filter((dir) => !chainDirs.includes(dir) && !usedDirs.has(dir));
      const choices = [];
      for (const dir of directions) {
        for (const name of names) if (canPlace(i, dir, name)) choices.push({ dir, name });
      }
      return choices;
    };

    while (placed < targetCount) {
      const positions = [];
      for (let i = 0; i < len; i++) {
        const choices = choicesAt(i, eligibleNamesAt(i));
        if (choices.length) positions.push({ i, choices });
      }
      if (!positions.length) break;
      const { i, choices } = choice(positions);
      const { dir, name } = choice(choices);
      place(i, dir, name);
    }
    return posInfo;
  }

  function buildBentGrid(path, posInfo) {
    const grid = emptyGrid();
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i];
      const chainDirs = computeChainDirs(path, i);
      const info = posInfo[i] || {};
      const branchDirs = Object.keys(info);
      grid[r][c] = panelForDirections(chainDirs.concat(branchDirs));

      for (const dir of branchDirs) {
        const name = info[dir];
        const length = SUBSTITUENT_LENGTH[name];
        const el = HALOGEN_ELEMENT_BY_NAME[name];
        const [dr, dc] = DELTA[dir];
        let rr = r, cc = c;
        for (let k = 0; k < length; k++) {
          rr += dr; cc += dc;
          const isLast = k === length - 1;
          grid[rr][cc] = panelForDirections(isLast ? [OPPOSITE[dir]] : [OPPOSITE[dir], dir]);
          if (isLast && name === HYDROXYL_ELEMENT) grid[rr][cc].element = HYDROXYL_ELEMENT;
          if (isLast && el) grid[rr][cc].element = el;
        }
      }
    }
    return grid;
  }

  // 難問モード用: 屈曲した主鎖 + 側鎖多め
  // bendRange: [min, max] で「折れ曲がり炭素(かど)の数」の範囲を指定(省略時は無制限)
  function generateBentAlkaneGrid(typeRange, opts, forceTurn, bendRange) {
    const { lenMin = 6, lenMax = 9, subMin = 2, subMax = 4, forceHydroxyl = false, hydroxylLimitOne = false } = opts || {};
    const [bendMin, bendMax] = bendRange || [0, Infinity];
    for (let attempt = 0; attempt < 60; attempt++) {
      const len = randInt(Math.max(2, lenMin), Math.max(2, lenMax));
      const walk = tryGenerateBentChain(len, forceTurn);
      if (!walk) continue;
      const bends = countBends(walk.path);
      if (bends < bendMin || bends > bendMax) continue; // 指定した折れ曲がり数の範囲外ならやり直す
      const occupied = new Set(walk.occupied);
      const posInfo = planBentSubstituents(walk.path, occupied, typeRange, subMin, subMax, forceHydroxyl, hydroxylLimitOne);
      return buildBentGrid(walk.path, posInfo);
    }
    return null; // 呼び出し元でリトライ
  }

  // 環状(シクロアルカン)のテンプレート: 2行×N列の「細長い長方形」の形。
  // 置換基の安全な取り付け位置などは buildRingGridFromPath 側で汎用的に計算するので、
  // ここでは経路(隣接するマスを順にたどった座標の並び)だけを持つ。
  function makeRingTemplate(width) {
    const cells = [];
    for (let c = 0; c < width; c++) cells.push([0, c]);
    for (let c = width - 1; c >= 0; c--) cells.push([1, c]);
    return { width, height: 2, cells };
  }
  const RING_TEMPLATES = {
    4: makeRingTemplate(2),   // シクロブタン
    6: makeRingTemplate(3),   // シクロヘキサン
    8: makeRingTemplate(4),   // シクロオクタン
    10: makeRingTemplate(5),  // シクロデカン
  };

  // 環(閉じた経路)上の位置iにおける、隣接パネルへの活性方向を求める(環は常に閉じているので前後は巡回する)
  function computeRingDirs(path, i) {
    const n = path.length;
    const prev = path[(i - 1 + n) % n];
    const next = path[(i + 1) % n];
    return [directionBetween(path[i], prev), directionBetween(path[i], next)];
  }

  // 盤面上をランダムに一周し、指定サイズちょうどで始点に隣接して戻れる閉路を探す
  // (長方形以外の、L字や階段状の環を作るための乱歩探索。バックトラック付き)
  function tryGenerateRingWalk(size) {
    const startR = randInt(0, ROWS - 1);
    const startC = randInt(0, COLS - 1);
    const path = [[startR, startC]];
    const occupied = new Set([`${startR},${startC}`]);
    let budget = 4000; // 探索が長引きすぎないための上限(超えたら諦めてリトライは呼び出し元に任せる)

    function backtrack() {
      if (--budget <= 0) return false;
      const [r, c] = path[path.length - 1];
      if (path.length === size) {
        const [sr, sc] = path[0];
        return Math.abs(r - sr) + Math.abs(c - sc) === 1; // 始点に隣接していれば閉じられる
      }
      for (const d of shuffle(['N', 'E', 'S', 'W'])) {
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        const key = `${nr},${nc}`;
        if (occupied.has(key)) continue;
        path.push([nr, nc]);
        occupied.add(key);
        if (backtrack()) return true;
        path.pop();
        occupied.delete(key);
      }
      return false;
    }

    return backtrack() ? { path, occupied } : null;
  }

  // 環の経路(path: [r,c]の配列。順に隣接し、最後は始点に隣接して閉じている)から、
  // 実際のグリッドを組み立てる。置換基は「環の他の炭素と隣接してしまわない」安全な位置にのみ置く。
  function buildRingGridFromPath(path, forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne) {
    const size = path.length;
    const grid = emptyGrid();
    const occupied = new Set(path.map(([r, c]) => `${r},${c}`));
    for (let i = 0; i < size; i++) {
      const [r, c] = path[i];
      grid[r][c] = panelForDirections(computeRingDirs(path, i));
    }

    // 置換基を安全に置ける候補(環の別の炭素と隣接しない位置)を集める
    const slots = [];
    for (let i = 0; i < size; i++) {
      const [r, c] = path[i];
      const ringDirs = computeRingDirs(path, i);
      for (const d of ['N', 'E', 'S', 'W']) {
        if (ringDirs.includes(d)) continue;
        const [dr, dc] = DELTA[d];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        if (occupied.has(`${nr},${nc}`)) continue;
        let safe = true;
        for (const d2 of ['N', 'E', 'S', 'W']) {
          const [dr2, dc2] = DELTA[d2];
          const nnr = nr + dr2, nnc = nc + dc2;
          if (nnr === r && nnc === c) continue; // 自分の付け根はOK
          if (occupied.has(`${nnr},${nnc}`)) { safe = false; break; }
        }
        if (safe) slots.push({ r, c, dir: d, nr, nc });
      }
    }
    shuffle(slots);
    const distinctNames = pickSpeciesForRange(typeRange, slots.length, forceHydroxyl);

    // 付ける個数を決める(subMin/subMaxが未指定なら従来通り0個か1個)
    let want;
    if (subMin === undefined || subMax === undefined) {
      want = (forceSubstituent || random() < 0.5) ? 1 : 0;
    } else {
      want = randInt(subMin, subMax);
      if (forceSubstituent && want < 1) want = 1;
    }

    let placed = 0;
    let hydroxylCount = 0;
    const hydroxylParents = new Set();
    for (const slot of slots) {
      if (placed >= want) break;
      if (occupied.has(`${slot.nr},${slot.nc}`)) continue; // 既に他の置換基が使った
      const parentKey = `${slot.r},${slot.c}`;
      const candidates = distinctNames.filter((name) => name !== HYDROXYL_ELEMENT
        || (!hydroxylParents.has(parentKey) && (!hydroxylLimitOne || hydroxylCount === 0)));
      if (candidates.length === 0) continue;
      const name = candidates.length === 1 ? candidates[0] : choice(candidates);
      const existing = getActiveDirections(grid[slot.r][slot.c]);
      grid[slot.r][slot.c] = panelForDirections([...existing, slot.dir]);
      const panel = panelFor(1, [OPPOSITE[slot.dir]]);
      if (name === HYDROXYL_ELEMENT) panel.element = HYDROXYL_ELEMENT;
      const el = HALOGEN_ELEMENT_BY_NAME[name];
      if (el) panel.element = el;
      grid[slot.nr][slot.nc] = panel;
      occupied.add(`${slot.nr},${slot.nc}`);
      if (name === HYDROXYL_ELEMENT) hydroxylParents.add(parentKey);
      if (name === HYDROXYL_ELEMENT) hydroxylCount++;
      placed++;
    }
    return grid;
  }

  // 環に付ける置換基は、設定された側鎖数(subMin〜subMax)に従って複数付ける。
  // 環の形は、定番の長方形と、盤面を自由に這うランダムな形(L字・階段状など)を半々くらいで混ぜる。
  function generateCycloalkaneGrid(forceSubstituent, ringSizes, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne) {
    const ringSize = choice(ringSizes || [4, 6]);
    const tmpl = RING_TEMPLATES[ringSize];
    const templatePath = () => {
      const baseRow = Math.floor((ROWS - tmpl.height) / 2);
      const baseCol = Math.floor((COLS - tmpl.width) / 2);
      return tmpl.cells.map(([dr, dc]) => [baseRow + dr, baseCol + dc]);
    };

    if (random() < 0.5) {
      return buildRingGridFromPath(templatePath(), forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      const walk = tryGenerateRingWalk(ringSize);
      if (walk) return buildRingGridFromPath(walk.path, forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
    }
    // ランダムな形が見つからなければ長方形にフォールバック
    return buildRingGridFromPath(templatePath(), forceSubstituent, subMin, subMax, typeRange, forceHydroxyl, hydroxylLimitOne);
  }

  // 正式名に現れる置換基・OH基の種類を、設定と重複回避で共通利用する。
  // 個数は無視するため、クロロとジクロロは同じ「クロロ」組み合わせになる。
  function groupTypesInName(name) {
    const types = [];
    if (name.includes('メチル')) types.push('メチル');
    if (name.includes('エチル')) types.push('エチル');
    if (name.includes('フルオロ')) types.push('フルオロ');
    if (name.includes('クロロ')) types.push('クロロ');
    if (name.includes('ブロモ')) types.push('ブロモ');
    if (name.includes('ヨード')) types.push('ヨード');
    if (name.endsWith('ノール') || name.endsWith('オール')) types.push('OH');
    return types;
  }
  function groupTypeSignature(name) {
    const types = groupTypesInName(name);
    return types.length ? types.join('|') : 'なし';
  }

  // 主鎖が炭素1個だけの構造(ハロゲン化メタン)を生成する。すいすい難度でのみ登場させる。
  function generateMethaneGrid(forceHydroxyl = false, maxTypeCount = Infinity, subMin = 1, subMax = 4) {
    const dirsByCount = { 1: ['E'], 2: ['E', 'W'], 3: ['E', 'W', 'N'], 4: ['E', 'W', 'N', 'S'] };
    const typeByCount = { 1: 1, 2: 2, 3: 4, 4: 5 };
    const minCount = Math.max(1, Math.min(4, Number(subMin) || 0));
    const maxCount = Math.max(0, Math.min(4, Number(subMax) || 0));
    if (minCount > maxCount) return null; // 例: 置換基数0〜0ではハロゲン化メタンを出さない
    // OHを必ず1種類として数える設定で種類数上限が1なら、OHだけのメタノールにする。
    // OHとハロゲンの混在を何度も生成してから棄却するのを避け、出題率も安定させる。
    if (forceHydroxyl && maxTypeCount <= 1 && minCount > 1) return null;
    const count = forceHydroxyl && maxTypeCount <= 1 ? 1 : randInt(minCount, maxCount);
    const dirs = dirsByCount[count];
    const grid = emptyGrid();
    const cr = 2, cc = Math.floor(COLS / 2);
    grid[cr][cc] = panelFor(typeByCount[count], dirs);
    const opp = { E: 'W', W: 'E', N: 'S', S: 'N' };
    const names = forceHydroxyl ? [...Object.keys(HALOGEN_ELEMENT_BY_NAME), HYDROXYL_ELEMENT] : Object.keys(HALOGEN_ELEMENT_BY_NAME);
    const forcedHydroxylDir = forceHydroxyl ? choice(dirs) : null;
    dirs.forEach((d) => {
      const [dr, dc] = DELTA[d];
      const panel = panelFor(1, [opp[d]]);
      // OHを強制する場合は、選んだ1方向だけをOHにする。
      // 先に別方向でOHが選ばれてジェミナルジオールになる候補を作らない。
      const candidates = names.filter((name) => name !== HYDROXYL_ELEMENT || d === forcedHydroxylDir);
      const name = d === forcedHydroxylDir ? HYDROXYL_ELEMENT : choice(candidates);
      panel.element = name === HYDROXYL_ELEMENT ? HYDROXYL_ELEMENT : HALOGEN_ELEMENT_BY_NAME[name];
      grid[cr + dr][cc + dc] = panel;
    });
    return grid;
  }

  // 構造が実際に占めている範囲(bounding box)の幅・高さを返す
  function gridExtent(g) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!g[r][c]) continue;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    }
    if (maxR < 0) return { w: 0, h: 0 };
    return { w: maxC - minC + 1, h: maxR - minR + 1 };
  }

  // opts: { typeMin, typeMax, lenMin, lenMax, subMin, subMax, useBent, forceTurn, forceRingSubstituent, ringSizes, bendRange, allowMethane, categoryWeights, maxWidth, maxHeight }
  //   typeMin / typeMax: この問題で使う置換基・OH基の「種類数」の範囲
  //   useBent: 屈曲した主鎖を使うか / forceTurn: できるだけ曲げるように誘導するか
  //   ringSizes: 環のサイズ候補(例: [4,6]) / bendRange: [min,max]で折れ曲がり炭素数を指定(省略時は無制限)
  //   allowMethane: 炭素1個だけの構造(ハロゲン化メタン)も出題対象に含めるか
  //   maxWidth / maxHeight: 出題する構造が収まるべき列数・行数の上限(盤面を狭めている難度で使う)
  function generateStructureWithOptions(opts) {
    const {
      typeMin = 1, typeMax = 1, lenMin = 2, lenMax = 7, subMin = 0, subMax = 4, useBent = false, forceTurn = false, forceRingSubstituent = false,
      ringSizes = [4, 6], bendRange = null, allowMethane = false, categoryWeights = null, alcoholEnabled = false, alcoholRate = 40, hydroxylLimitOne = false,
      hydroxylCountsAsSubstituent = true, cycloLimitOne = false,
      maxWidth = COLS, maxHeight = ROWS,
    } = opts || {};
    // OHを候補の重みで増やすのではなく、問題単位で含めるかを決める。
    // 有効時は設定した割合で、少なくとも1個のOHを含む問題になる。
    const normalizedAlcoholRate = Math.max(0, Math.min(100, Number(alcoholRate) || 0));
    const forceHydroxyl = alcoholEnabled && random() * 100 < normalizedAlcoholRate;
    // OHを数えない場合でも、生成する問題にはOHを少なくとも1個追加する。
    // 設定された種類数・個数はOHを除いた置換基について満たすよう、生成用の範囲だけ
    // OH 1個分を広げ、最終的には名称から数え直して厳密に判定する。
    const hydroxylCounts = !!hydroxylCountsAsSubstituent;
    const extraHydroxylForGeneration = forceHydroxyl && !hydroxylCounts ? 1 : 0;
    const generationTypeRange = [typeMin + extraHydroxylForGeneration, typeMax + extraHydroxylForGeneration];
    const generationSubMin = subMin + extraHydroxylForGeneration;
    const generationSubMax = subMax + extraHydroxylForGeneration;
    function hydroxylCountInGrid(g) {
      return g.flat().filter((panel) => panel && panel.element === HYDROXYL_ELEMENT).length;
    }
    function finalize(g, expectedParentLength = null, limitedRing = false) {
      // 盤面の使用可能な範囲に収まらない構造は出題しない(組み立て不可能になるため)
      const extent = gridExtent(g);
      if (extent.w > maxWidth || extent.h > maxHeight) return null;
      if (checkPhysicalPanelDirections(g).length > 0) return null;
      const result = generateName(g);
      if (!result.ok) return null;
      const hydroxylCount = hydroxylCountInGrid(g);
      if (forceHydroxyl && hydroxylCount === 0) return null;
      if (hydroxylLimitOne && hydroxylCount > 1) return null;
      // 分岐の位置によっては最長鎖ルールの都合で主鎖の解釈が変わり、
      // 意図せず種類数が設定範囲から外れることがあるため、実際の結果を見てから判定する。
      // ただし置換基が1つも無い構造(種類数0)は、下限が何であっても許容する。
      const groupSummary = namedGroupSummary(result.name);
      if (!groupSummary) return null;
      const countedTotal = groupSummary.total - (hydroxylCounts ? 0 : groupSummary.hydroxylCount);
      if (limitedRing) {
        if (groupSummary.total > 1 || (forceRingSubstituent && groupSummary.total !== 1)) return null;
      } else if (countedTotal < subMin || countedTotal > subMax) return null;
      // 鎖状問題は、生成時に選んだ主鎖長と最長鎖が一致するものだけを採用する。
      // 側鎖が実質的に主鎖を延長した構造を、別の主鎖長の問題として出題しない。
      if (expectedParentLength !== null && groupSummary.parentCarbonCount !== expectedParentLength) return null;
      const typeCount = hydroxylCounts ? groupSummary.types.length : groupSummary.types.filter((type) => type !== 'OH').length;
      if (!limitedRing && (typeCount > typeMax || (typeCount > 0 && typeCount < typeMin))) return null;
      return { grid: g, name: result.name, parentCarbonCount: groupSummary.parentCarbonCount, fellBack: false };
    }
    function tryMethane() {
      try {
        const g = generateMethaneGrid(forceHydroxyl, generationTypeRange[1], generationSubMin, generationSubMax);
        return g ? finalize(g) : null;
      } catch (e) { return null; }
    }
    function tryCyclo() {
      try {
        const ringMin = cycloLimitOne ? ((forceRingSubstituent || forceHydroxyl) ? 1 : 0) : generationSubMin;
        const ringMax = cycloLimitOne ? 1 : generationSubMax;
        const ringTypes = cycloLimitOne ? [1,1] : generationTypeRange;
        return finalize(generateCycloalkaneGrid(forceRingSubstituent, ringSizes, ringMin, ringMax, ringTypes, forceHydroxyl, hydroxylLimitOne), null, cycloLimitOne);
      } catch (e) { return null; }
    }
    function tryChainLen(len) {
      try {
        const lenOpts = { ...opts, lenMin: len, lenMax: len, subMin: generationSubMin, subMax: generationSubMax, forceHydroxyl, hydroxylLimitOne };
        const g = useBent ? generateBentAlkaneGrid(generationTypeRange, lenOpts, forceTurn, bendRange) : generateAlkaneGrid(generationTypeRange, lenOpts);
        return g ? finalize(g, len) : null;
      } catch (e) { return null; }
    }

    // 問題形式(メタン／鎖状／環状)を先に重み付きで選び、鎖状なら主鎖長を均等に選ぶ。
    // これで主鎖範囲を変えてもメタン・環状の出題率が意図せず変わらない。
    const methaneMinCount = Math.max(1, Number(generationSubMin) || 0);
    const methaneMaxCount = Math.min(4, Number(generationSubMax) || 0);
    const methaneEligible = allowMethane && methaneMinCount <= methaneMaxCount
      && !(forceHydroxyl && generationTypeRange[1] <= 1 && methaneMinCount > 1);
    const categories = [];
    if (methaneEligible) categories.push({ kind: 'methane' });
    for (let l = Math.max(2, lenMin); l <= Math.max(2, lenMax); l++) categories.push({ kind: 'chain', len: l });
    categories.push({ kind: 'cyclo' });
    const chainCategories = categories.filter((cat) => cat.kind === 'chain');

    function tryCategory(cat) {
      if (cat.kind === 'methane') return tryMethane();
      if (cat.kind === 'cyclo') return tryCyclo();
      return tryChainLen(cat.len);
    }

    const familyChoices = [
      ...(methaneEligible ? [{ kind: 'methane', weight: categoryWeights?.methane ?? 10 }] : []),
      ...(chainCategories.length ? [{ kind: 'chain', weight: categoryWeights?.chain ?? 75 }] : []),
      { kind: 'cyclo', weight: categoryWeights?.cyclo ?? 15 },
    ].filter((item) => item.weight > 0);
    const totalWeight = familyChoices.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * totalWeight;
    let family = familyChoices[familyChoices.length - 1].kind;
    for (const item of familyChoices) {
      roll -= item.weight;
      if (roll < 0) { family = item.kind; break; }
    }
    const preferred = family === 'chain' ? choice(chainCategories) : categories.find((cat) => cat.kind === family);
    const orderedCategories = [preferred, ...shuffle(categories.filter((cat) => cat !== preferred))];

    const attemptsPerCategory = 25;
    for (const cat of orderedCategories) {
      for (let i = 0; i < attemptsPerCategory; i++) {
        const r = tryCategory(cat);
        if (r) return r;
      }
    }
    // それでも決まらない場合の保険(かなり厳しい設定のとき): カテゴリを問わずもう少し粘る
    for (let i = 0; i < 80; i++) {
      const r = tryCategory(choice(categories));
      if (r) return r;
    }
    return null;
  }

  // ============================================================
  const BASE_NAME_TOKENS = CHAIN_NAMES.slice(1, 11);
  const BASE_NAME_SET = new Set(BASE_NAME_TOKENS);
  const CYCLO_TOKEN = 'シクロ';
  const ALCOHOL_TOKEN = 'オール';
  const SUB_NAME_SET = new Set(['メチル', 'エチル', 'フルオロ', 'クロロ', 'ブロモ', 'ヨード']);
  // 命名側と語群側で同じ数詞表を使う。index 0・1 は接頭語なしなので除く。
  const MULTIPLIER_TOKENS = MULTIPLIER_PREFIX.slice(2);
  const MULTIPLIER_SET = new Set(MULTIPLIER_TOKENS);
  function reconstructNameFromTokens(tokens) {
    let i = 0;
    const groups = [];
    let usedLocants = false; // 位置番号ありのグループを1つでも読んだか(連結記号の切り替えに使う)

    // 数字から始まる置換基グループ(位置番号あり)。数字の後に置換基が続く場合だけ消費する。
    while (i < tokens.length && /^\d+$/.test(tokens[i])) {
      const start = i;
      const locants = [];
      while (i < tokens.length && /^\d+$/.test(tokens[i])) { locants.push(tokens[i]); i++; }
      let multiplier = '';
      if (i < tokens.length && MULTIPLIER_SET.has(tokens[i])) { multiplier = tokens[i]; i++; }
      if (i >= tokens.length || !SUB_NAME_SET.has(tokens[i])) { i = start; break; }
      usedLocants = true;
      groups.push(`${locants.join(',')}-${multiplier}${tokens[i]}`);
      i++;
    }
    // 位置番号を省略した置換基グループ(メタン置換体、単置換シクロアルカン、単置換エタン)。
    // メタン置換体は同じ置換基が2個以上あるとき倍数詞(ジ・トリ・テトラ)だけが付き、位置番号は付かない。
    while (i < tokens.length && (SUB_NAME_SET.has(tokens[i]) || MULTIPLIER_SET.has(tokens[i]))) {
      let multiplier = '';
      if (MULTIPLIER_SET.has(tokens[i])) { multiplier = tokens[i]; i++; }
      if (i >= tokens.length || !SUB_NAME_SET.has(tokens[i])) return null;
      groups.push(`${multiplier}${tokens[i]}`);
      i++;
    }
    // アルコールの位置番号(置換基グループの後、主鎖の前)を読む。
    const alcoholLocants = [];
    while (i < tokens.length && /^\d+$/.test(tokens[i])) { alcoholLocants.push(tokens[i]); i++; }

    // 「シクロ」があれば、その次に来る鎖の名前と繋げて環の名前にする
    let cycloPrefix = '';
    if (i < tokens.length && tokens[i] === CYCLO_TOKEN) { cycloPrefix = CYCLO_TOKEN; i++; }
    if (i >= tokens.length || !BASE_NAME_SET.has(tokens[i])) return null;
    const baseToken = tokens[i];
    const base = cycloPrefix + baseToken;
    i++;

    let alcoholMultiplier = '';
    if (i < tokens.length && MULTIPLIER_SET.has(tokens[i])) { alcoholMultiplier = tokens[i]; i++; }
    const hasAlcohol = i < tokens.length && tokens[i] === ALCOHOL_TOKEN;
    if (hasAlcohol) i++;
    if (i !== tokens.length) return null; // 余分なトークンが残っている

    if (hasAlcohol) {
      const multiplierCount = alcoholMultiplier ? MULTIPLIER_PREFIX.indexOf(alcoholMultiplier) : 1;
      if (!multiplierCount) return null;
      if (alcoholLocants.length > 0) {
        if (new Set(alcoholLocants).size !== alcoholLocants.length) return null; // ジェミナルジオールを防ぐ
        if (alcoholLocants.length !== multiplierCount) return null;
      } else if (multiplierCount !== 1) {
        return null;
      }
      const carbonCount = CHAIN_NAMES.indexOf(baseToken);
      if (alcoholLocants.some((n) => Number(n) < 1 || Number(n) > carbonCount)) return null;
      const alcoholStem = base.endsWith('ン') ? `${base.slice(0, -1)}ノール` : `${base}ノール`;
      const suffix = multiplierCount === 1 ? alcoholStem : `${base}${alcoholMultiplier}オール`;
      const alcoholPrefix = alcoholLocants.length ? `${alcoholLocants.join(',')}-` : '';
      const subPrefix = groups.join(usedLocants ? '-' : '');
      return subPrefix + (subPrefix && alcoholPrefix ? '-' : '') + alcoholPrefix + suffix;
    }
    if (alcoholLocants.length || alcoholMultiplier) return null;
    return groups.join(usedLocants ? '-' : '') + base;
  }
  function parseGame2SubstituentDescriptor(descriptor) {
    const substituentNames = [...SUB_NAME_SET].sort((a, b) => b.length - a.length);
    for (const name of substituentNames) {
      if (!descriptor.endsWith(name)) continue;
      const multiplier = descriptor.slice(0, -name.length);
      if (multiplier === '') return [name];
      if (MULTIPLIER_SET.has(multiplier)) return [multiplier, name];
    }
    return null;
  }

  // メタン置換体や単置換シクロアルカンの、位置番号を省略した接頭部を語句へ戻す。
  // 例: 「ジクロロフルオロ」→「ジ」「クロロ」「フルオロ」
  function parseGame2UnlocantedPrefix(prefix) {
    const pieces = [];
    for (const name of SUB_NAME_SET) {
      pieces.push({ text: name, tokens: [name] });
      for (const multiplier of MULTIPLIER_TOKENS) {
        pieces.push({ text: multiplier + name, tokens: [multiplier, name] });
      }
    }
    pieces.sort((a, b) => b.text.length - a.text.length);
    const parsedAt = Array(prefix.length + 1).fill(null);
    parsedAt[0] = [];
    for (let index = 0; index < prefix.length; index++) {
      if (parsedAt[index] === null) continue;
      for (const piece of pieces) {
        if (!prefix.startsWith(piece.text, index)) continue;
        const nextIndex = index + piece.text.length;
        if (parsedAt[nextIndex] === null) parsedAt[nextIndex] = parsedAt[index].concat(piece.tokens);
      }
    }
    return parsedAt[prefix.length];
  }

  function parseGame2SubstituentPrefix(rawPrefix) {
    const prefix = rawPrefix.endsWith('-') ? rawPrefix.slice(0, -1) : rawPrefix;
    if (prefix === '') return [];
    if (!/^\d/.test(prefix)) return parseGame2UnlocantedPrefix(prefix);

    const parts = prefix.split('-');
    if (parts.length % 2 !== 0) return null;
    const tokens = [];
    for (let index = 0; index < parts.length; index += 2) {
      if (!/^\d+(?:,\d+)*$/.test(parts[index])) return null;
      const descriptorTokens = parseGame2SubstituentDescriptor(parts[index + 1]);
      if (descriptorTokens === null) return null;
      tokens.push(...parts[index].split(','), ...descriptorTokens);
    }
    return tokens;
  }

  // 正答名は命名エンジンが生成した正式名なので、同じ文法を逆向きにたどって
  // ゲーム②で並べるべき語句列へ戻す。最後に再構成して完全一致も確認する。
  function expectedGame2AnswerTokens(name) {
    const baseNames = [...BASE_NAME_TOKENS].sort((a, b) => b.length - a.length);
    const tryCandidate = (prefix, alcoholLocants, cyclo, baseName, alcoholMultiplier = '', hasAlcohol = false) => {
      const prefixTokens = parseGame2SubstituentPrefix(prefix);
      if (prefixTokens === null) return null;
      const tokens = [...prefixTokens, ...alcoholLocants];
      if (cyclo) tokens.push(CYCLO_TOKEN);
      tokens.push(baseName);
      if (alcoholMultiplier) tokens.push(alcoholMultiplier);
      if (hasAlcohol) tokens.push(ALCOHOL_TOKEN);
      return reconstructNameFromTokens(tokens) === name ? tokens : null;
    };

    for (const baseName of baseNames) {
      for (const cyclo of [false, true]) {
        const parentName = (cyclo ? CYCLO_TOKEN : '') + baseName;

        // 多価アルコール: 1,2-エタンジオール など。
        for (const multiplier of MULTIPLIER_TOKENS) {
          const suffix = parentName + multiplier + ALCOHOL_TOKEN;
          if (!name.endsWith(suffix)) continue;
          const beforeSuffix = name.slice(0, -suffix.length);
          const match = beforeSuffix.match(/^(.*?)(\d+(?:,\d+)*)-$/);
          if (!match) continue;
          const candidate = tryCandidate(match[1], match[2].split(','), cyclo, baseName, multiplier, true);
          if (candidate) return candidate;
        }

        // 一価アルコール: プロパノール／2-プロパノール など。
        const alcoholStem = parentName.endsWith('ン') ? parentName.slice(0, -1) + 'ノール' : parentName + 'オール';
        if (name.endsWith(alcoholStem)) {
          const beforeStem = name.slice(0, -alcoholStem.length);
          const locanted = beforeStem.match(/^(.*?)(\d+)-$/);
          if (locanted) {
            const candidate = tryCandidate(locanted[1], [locanted[2]], cyclo, baseName, '', true);
            if (candidate) return candidate;
          }
          const candidate = tryCandidate(beforeStem, [], cyclo, baseName, '', true);
          if (candidate) return candidate;
        }

        // アルカン・シクロアルカン。
        if (name.endsWith(parentName)) {
          const candidate = tryCandidate(name.slice(0, -parentName.length), [], cyclo, baseName);
          if (candidate) return candidate;
        }
      }
    }
    return null;
  }

  // 正式名を解答トークンへ戻し、最終的に命名された置換基・OH基の総数を数える。
  // 生成時に置いた枝数ではなく、最長鎖・主環を選び直した後の名称を基準にすることで、
  // すべての問題形式を同じ設定境界で検査できる。
  function namedGroupSummary(name) {
    const tokens = expectedGame2AnswerTokens(name);
    if (tokens === null) return null;
    const baseName = tokens.find((token) => BASE_NAME_SET.has(token));
    const parentCarbonCount = baseName ? BASE_NAME_TOKENS.indexOf(baseName) + 1 : 0;
    let total = 0;
    let hydroxylCount = 0;
    const countForIndex = (index) => {
      const multiplierIndex = MULTIPLIER_PREFIX.indexOf(tokens[index - 1]);
      return multiplierIndex >= 2 ? multiplierIndex : 1;
    };
    tokens.forEach((token, index) => {
      const count = countForIndex(index);
      if (SUB_NAME_SET.has(token)) total += count;
      if (token === ALCOHOL_TOKEN) {
        total += count;
        hydroxylCount += count;
      }
    });
    return { total, hydroxylCount, types: groupTypesInName(name), signature: groupTypeSignature(name), parentCarbonCount };
  }

  function questionGridSignature(g) {
    return g.flat().map((panel) => panel ? `${panel.type}:${panel.rotation}:${panel.element || 'C'}` : '.').join('|');
  }
  function questionTypeSignature(result) {
    return namedGroupSummary(result.name)?.signature || groupTypeSignature(result.name);
  }
  // ハロゲンの位置だけが違う同じ主鎖・アルキル側鎖の連続を避けるための簡略骨格署名。
  // indexの出題はエチルまでなので、ここでも対象をメチル・エチルに固定する。
  function questionBackboneSignature(result) {
    const parentCount = result.parentCarbonCount || namedGroupSummary(result.name)?.parentCarbonCount || 0;
    const parentKind = result.name.includes('シクロ') ? '環' : '鎖';
    let longestAlkyl = 0;
    let longestAlkylLocants = '';
    for (const [length, alkylName] of [[1, 'メチル'], [2, 'エチル']]) {
      const matches = [...result.name.matchAll(new RegExp(`(?:^|-)(\\d+(?:,\\d+)*)-(?:ジ|トリ|テトラ|ペンタ|ヘキサ|ヘプタ|オクタ|ノナ|デカ)?${alkylName}`, 'g'))];
      if (!matches.length) continue;
      if (length > longestAlkyl) {
        longestAlkyl = length;
        longestAlkylLocants = matches.flatMap((match) => match[1].split(',')).sort((a, b) => Number(a) - Number(b)).join(',');
      }
    }
    return `${parentKind}${parentCount}|側鎖${longestAlkyl}@${longestAlkylLocants || '-'}`;
  }
  // 並べるでは、命名後に現れる鎖状主鎖の位置番号を短い履歴で均す。
  // 配置前の位置を均等にしても、最小番号則で向きが反転するため、ここでは正式名から
  // ロカントを取り出して評価する。環状化合物とメタンは番号の意味が別なので対象外にする。
  const LOCANT_BALANCE_WINDOW = 36;
  const LOCANT_BALANCE_EXTRA_CANDIDATES = 4;
  const recentGame1LocantProfiles = [];
  function questionChainLocantProfile(result) {
    const summary = namedGroupSummary(result.name);
    if (!summary || summary.parentCarbonCount < 2 || result.name.includes('シクロ')) return null;
    const tokens = expectedGame2AnswerTokens(result.name);
    if (!tokens) return null;
    const parentCount = summary.parentCarbonCount;
    const locants = tokens.filter((token) => /^\d+$/.test(token))
      .map(Number)
      .filter((locant) => locant >= 1 && locant <= parentCount);
    // エタノールでは OH の 1 を表記しないため、出題上の位置番号として補う。
    const alcoholIndex = tokens.lastIndexOf(ALCOHOL_TOKEN);
    if (parentCount === 2 && alcoholIndex >= 0 && !MULTIPLIER_SET.has(tokens[alcoholIndex - 1])) locants.push(1);
    return locants.length ? { parentCount, locants } : null;
  }
  function rememberGame1LocantProfile(result) {
    const profile = questionChainLocantProfile(result);
    if (!profile) return;
    recentGame1LocantProfiles.push(profile);
    if (recentGame1LocantProfiles.length > LOCANT_BALANCE_WINDOW) recentGame1LocantProfiles.shift();
  }
  function resetGame1LocantProfiles() {
    recentGame1LocantProfiles.length = 0;
  }
  function locantBalancePenalty(result) {
    const profile = questionChainLocantProfile(result);
    if (!profile) return null;
    const relevant = recentGame1LocantProfiles.filter((item) => item.parentCount === profile.parentCount);
    // 最初の数問は履歴不足で恣意的に寄せない。
    if (relevant.length < 2) return null;
    const counts = Array(profile.parentCount + 1).fill(0);
    for (const item of relevant) for (const locant of item.locants) counts[locant]++;
    for (const locant of profile.locants) counts[locant]++;
    const mean = counts.slice(1).reduce((sum, count) => sum + count, 0) / profile.parentCount;
    return counts.slice(1).reduce((sum, count) => sum + (count - mean) ** 2, 0);
  }
  function pickLocantBalancedQuestion(candidates) {
    const scored = candidates.map((result) => ({ result, penalty: locantBalancePenalty(result) }));
    const usable = scored.filter((item) => item.penalty !== null);
    if (!usable.length) return choice(candidates);
    const bestPenalty = Math.min(...usable.map((item) => item.penalty));
    return choice(usable.filter((item) => item.penalty === bestPenalty)).result;
  }
  function rememberQuestion(history, result) {
    history.push({
      name: result.name,
      signature: questionGridSignature(result.grid),
      typeSignature: questionTypeSignature(result),
      backboneSignature: questionBackboneSignature(result),
    });
    if (history.length > 8) history.shift();
  }
  function generateAvoidingRecentRepeat(opts, history, accept = () => true) {
    const recentNames = new Set(history.slice(-8).map((item) => item.name));
    const recentSignatures = new Set(history.slice(-4).map((item) => item.signature));
    const recentBackbones = new Set(history.slice(-4).map((item) => item.backboneSignature));
    const previous = history[history.length - 1] || null;
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      const result = generateStructureWithOptions(opts);
      if (!result || !accept(result)) continue;
      const signature = questionGridSignature(result.grid);
      const typeSignature = questionTypeSignature(result);
      const backboneSignature = questionBackboneSignature(result);
      const nameIsFresh = !recentNames.has(result.name);
      const gridIsFresh = !recentSignatures.has(signature);
      const backboneIsFresh = !recentBackbones.has(backboneSignature);
      const typeIsFresh = !previous || typeSignature !== previous.typeSignature;
      candidates.push({ result, signature, typeSignature, backboneSignature, nameIsFresh, gridIsFresh, backboneIsFresh, typeIsFresh });
      // 最終保険問題（通常はエタン）は、設定内の通常問題を探し切ってからだけ採用する。
      if (!result.fellBack && nameIsFresh && gridIsFresh && backboneIsFresh && typeIsFresh) {
        if (!opts.balanceLocants || !questionChainLocantProfile(result)) return result;
        // 最初に決まった問題形式・主鎖長は維持し、同じ鎖長の候補だけを少数比較する。
        // そのため、環状問題の割合や通常の難易度設定は変わらない。
        const parentCount = questionChainLocantProfile(result).parentCount;
        const alternatives = [result];
        const alternativeNames = new Set([result.name]);
        const alternativeSignatures = new Set([signature]);
        const alternativeOpts = {
          ...opts,
          lenMin: parentCount,
          lenMax: parentCount,
          allowMethane: false,
          categoryWeights: { chain: 100, cyclo: 0, methane: 0 },
        };
        for (let extra = 0; extra < LOCANT_BALANCE_EXTRA_CANDIDATES; extra++) {
          const alternative = generateStructureWithOptions(alternativeOpts);
          if (!alternative || !accept(alternative)) continue;
          const alternativeProfile = questionChainLocantProfile(alternative);
          if (!alternativeProfile || alternativeProfile.parentCount !== parentCount || alternative.fellBack) continue;
          const alternativeSignature = questionGridSignature(alternative.grid);
          const alternativeType = questionTypeSignature(alternative);
          const alternativeBackbone = questionBackboneSignature(alternative);
          if (recentNames.has(alternative.name) || recentSignatures.has(alternativeSignature)
            || recentBackbones.has(alternativeBackbone) || (previous && alternativeType === previous.typeSignature)
            || alternativeNames.has(alternative.name) || alternativeSignatures.has(alternativeSignature)) continue;
          alternatives.push(alternative);
          alternativeNames.add(alternative.name);
          alternativeSignatures.add(alternativeSignature);
        }
        return pickLocantBalancedQuestion(alternatives);
      }
    }
    // 全条件を満たせない狭い設定では、まず直前と種類の組み合わせが変わる候補を優先する。
    // それも不可能なときだけ従来どおり、名称・盤面が新しい候補、最後に先頭候補へ緩和する。
    const normalCandidates = candidates.filter((item) => !item.result.fellBack);
    const changedCombination = normalCandidates.find((item) => item.typeIsFresh && item.backboneIsFresh
      && (!previous || item.result.name !== previous.name) && (!previous || item.signature !== previous.signature));
    if (changedCombination) return changedCombination.result;
    const otherwiseFresh = normalCandidates.find((item) => item.nameIsFresh && item.gridIsFresh && item.backboneIsFresh);
    return (otherwiseFresh || normalCandidates[0] || candidates[0])?.result || null;
  }


  return { generateName, generateStructureWithOptions, generateAvoidingRecentRepeat, rememberQuestion, rememberGame1LocantProfile, expectedGame2AnswerTokens, reconstructNameFromTokens, namedGroupSummary, groupTypeSignature, gridExtent, buildGraph, findRing, getActiveDirections, shuffle, CHAIN_NAMES, MULTIPLIER_TOKENS, SUB_NAME_SET };
}
