import { siteConfig, filterConfig, cardData } from './data.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==========================================
// 1. 各種定数と基本設定
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBBMuCXDKeF7sjBnPN8GqGy3WZ32HMYfQ0",
  authDomain: "tourmas-checker-b05c1.firebaseapp.com",
  projectId: "tourmas-checker-b05c1",
  storageBucket: "tourmas-checker-b05c1.firebasestorage.app",
  messagingSenderId: "3796099655",
  appId: "1:3796099655:web:0a01862393e31117ec8762"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let ownedCardIds = new Set();
let userCardDetails = {}; 
let userFormations = [];
let hasUnsavedChanges = false; 
let seriesSetForModal = new Set(); 

const themes = {
  default: { main: '#ff66a3', sub: '#ffebf0' },
  as: { main: '#f34f6d', sub: '#fce4e8' },
  cg: { main: '#2681c8', sub: '#e4f0f9' },
  ml: { main: '#ffc30b', sub: '#fff8e1' },
  sidem: { main: '#0fbe94', sub: '#e0f7f1' },
  sc: { main: '#8dbbff', sub: '#eef4ff' },
  gakumas: { main: '#f39800', sub: '#feeee0' }
};

const rarityOrder = { "UR": 9, "SSR": 8, "SR": 7, "R": 6, "N": 5, "CO": 4, "TSSR": 3, "TSR": 2, "TR": 1 };

const egaoEffects = [
  "コンボ時のスコアUP", "GOOD以上判定時のスコアUP", "GREAT以上判定時のスコアUP", "PERFECT判定時のスコアUP",
  "成功判定のコンボ数UP", "すべての判定がPERFECTになる", "GOOD以上判定がPERFECTになる", "GREAT判定がPERFECTになる",
  "MISS判定でもコンボが継続する", "コンボ数に応じてスコア獲得", "FEVERゲージ上昇率UP", "判定が長くなる",
  "MISS判定時スコアDOWN", "判定が短くなる", "FEVERゲージを消費する", "SPアピール回数を1回消費"
];

// ==========================================
// 2. 究極のアイドルブランドマッピング
// ==========================================
const idolBrandMap = new Map();
// ① data.jsの名簿に brand プロパティがあれば最優先
filterConfig.idols.forEach(idol => {
    if (idol.brand) idolBrandMap.set(idol.name, idol.brand);
});
// ② data.jsにbrandがない場合は、カードデータから自動推測
cardData.forEach(c => {
    if (c["アイドル名"] && c["シリーズブランド名"] && !idolBrandMap.has(c["アイドル名"])) {
        idolBrandMap.set(c["アイドル名"], c["シリーズブランド名"]);
    }
});
// ③ それでも不明なアイドルは「アイドルマスター」に仮置き
filterConfig.idols.forEach(idol => {
    if (!idolBrandMap.has(idol.name)) {
        idolBrandMap.set(idol.name, "アイドルマスター");
    }
});

// ==========================================
// 3. ユーザーカスタマイズ設定（LocalStorage管理）
// ==========================================
const defaultModalItems = [
  { id: 'number', label: '番号', show: true },
  { id: 'rarity', label: 'レアリティ', show: true },
  { id: 'type', label: '種類', show: true },
  { id: 'appeal', label: 'アピール値', show: true },
  { id: 'target', label: '対象／効果対象', show: true },
  { id: 'part', label: '部位', show: true },
  { id: 'genre', label: 'ジャンル', show: true },
  { id: 'effect', label: '効果／リズム効果', show: true },
  { id: 'note', label: '備考', show: true },
  { id: 'relax', label: '制限緩和', show: true },
  { id: 'comment', label: 'コメント', show: true },
  { id: 'series', label: '入手手段', show: true },
  { id: 'bonus', label: 'セットボーナス', show: true },
  { id: 'altcard', label: '別カード', show: true },
  { id: 'color', label: '色違い', show: true },
  { id: 'utsurikomi', label: '写り込み', show: true }
];
let modalConfig;
try {
  const savedConfig = localStorage.getItem('tourmas_modalConfig');
  modalConfig = savedConfig ? JSON.parse(savedConfig) : JSON.parse(JSON.stringify(defaultModalItems));
  if (!Array.isArray(modalConfig)) modalConfig = JSON.parse(JSON.stringify(defaultModalItems));
} catch (e) { modalConfig = JSON.parse(JSON.stringify(defaultModalItems)); }

const defaultMenuItems = [
  { id: 'collection', label: 'カード一覧に戻る' },
  { id: 'formation', label: 'マイ編成メモ' },
  { id: 'auth', label: 'アカウント・ログイン' },
  { id: 'mode', label: '詳細モード・挙動設定' },
  { id: 'series', label: '表示する弾数' },
  { id: 'settings', label: 'チェッカー設定' },
  { id: 'privacy', label: 'プライバシーポリシー' },
  { id: 'egao', label: '笑顔満点ですっ占い' }
];
let menuConfig;
try {
  const savedMenu = localStorage.getItem('tourmas_menuConfig');
  menuConfig = savedMenu ? JSON.parse(savedMenu) : JSON.parse(JSON.stringify(defaultMenuItems));
  if (!Array.isArray(menuConfig)) menuConfig = JSON.parse(JSON.stringify(defaultMenuItems));
} catch (e) { menuConfig = JSON.parse(JSON.stringify(defaultMenuItems)); }

const defaultFilterGroups = [
  { id: 'owned', label: '所持状況', open: true },
  { id: 'wish', label: '欲しいリスト', open: true },
  { id: 'rarity', label: 'レアリティ', open: true },
  { id: 'type', label: 'カード種類', open: true },
  { id: 'brand', label: 'ブランド', open: true },
  { id: 'target', label: '対象・効果', open: true },
  { id: 'part', label: '部位', open: true },
  { id: 'genre', label: 'ジャンル', open: true },
  { id: 'idol', label: 'アイドル', open: false }
];
let filterConfigGroups;
try {
  const savedFilter = localStorage.getItem('tourmas_filterConfig');
  filterConfigGroups = savedFilter ? JSON.parse(savedFilter) : JSON.parse(JSON.stringify(defaultFilterGroups));
  if (!Array.isArray(filterConfigGroups)) filterConfigGroups = JSON.parse(JSON.stringify(defaultFilterGroups));
} catch (e) { filterConfigGroups = JSON.parse(JSON.stringify(defaultFilterGroups)); }

// ==========================================
// 4. 便利関数
// ==========================================
const safeAddListener = (id, event, handler) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
};

const applyTheme = (themeKey) => {
  const t = themes[themeKey] || themes['default'];
  document.documentElement.style.setProperty('--main-color', t.main);
  document.documentElement.style.setProperty('--sub-color', t.sub);
};

const updateUserInfo = () => {
  const userInfo = document.getElementById('userInfo');
  if(!userInfo) return;
  if (currentUser) {
    const pt = document.getElementById('privacyToggle');
    if (pt && pt.checked) {
      userInfo.innerText = `プロデューサー さん`;
    } else {
      userInfo.innerText = `${currentUser.displayName} さん`;
    }
  } else {
    userInfo.innerText = "未ログイン（セーブ不可）";
  }
};

window.switchView = (viewId) => {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  const targetView = document.getElementById('view-' + viewId);
  if(targetView) targetView.classList.add('active');
  if (viewId === 'formation') window.renderFormations();
  if (viewId === 'settings') {
      window.renderModalOrderSettings();
      window.renderMenuOrderSettings();
      window.renderFilterOrderSettings();
  }
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if(sb) sb.classList.remove('open');
  if(ov) ov.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.markAsUnsaved = () => {
  hasUnsavedChanges = true;
  document.querySelectorAll('.cloud-save-btn').forEach(btn => {
    btn.style.display = 'inline-block';
    btn.classList.add('unsaved');
    btn.innerText = "セーブ(未保存)";
  });
};

window.triggerCloudSave = async () => {
  if (!currentUser) return alert("セーブするにはGoogleログインしてください。");
  const detailModal = document.getElementById('detailModal');
  if (detailModal && detailModal.classList.contains('open')) window.updateLocalMemory();

  await setDoc(doc(db, "users", currentUser.uid), { 
    ownedCards: Array.from(ownedCardIds), 
    cardDetails: userCardDetails,
    formations: userFormations 
  }, { merge: true });
  
  hasUnsavedChanges = false;
  document.querySelectorAll('.cloud-save-btn').forEach(btn => {
      btn.classList.remove('unsaved');
      btn.innerText = "クラウドにセーブ済";
  });
  
  const toast = document.getElementById('toast');
  if(toast) {
    toast.innerText = "クラウドに一括保存しました！";
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
};

// ==========================================
// 5. 動的HTML生成（サイドバー・フィルター等）
// ==========================================
window.renderSidebarMenu = () => {
  const sidebar = document.getElementById('sidebar');
  if(!sidebar) return;
  
  const sections = {
    'collection': `<div id="menu-collection" class="menu-section"><button class="nav-btn" onclick="switchView('collection')">カード一覧に戻る</button></div>`,
    'formation': `<div id="menu-formation" class="menu-section"><button class="nav-btn" onclick="switchView('formation')" style="border-color: #1a73e8; color: #1a73e8;">マイ編成メモ</button></div>`,
    'auth': `<div id="menu-auth" class="menu-section auth-container"><span id="userInfo">未ログイン</span><label class="checkbox-label" style="justify-content: center; font-size: 11px; margin-top: 5px;"><input type="checkbox" id="privacyToggle"> 名前を隠す</label><button id="loginBtn">Googleでログイン</button><button id="logoutBtn" class="logout-btn" style="display:none;">ログアウト</button></div>`,
    'mode': `<div id="menu-mode" class="menu-section mode-switch"><label class="checkbox-label" style="margin: 0;"><input type="checkbox" id="detailModeToggle"> 詳細確認モード</label><label class="checkbox-label" style="margin: 10px 0 0 0; font-size: 12px; font-weight: normal; color: #555;"><input type="checkbox" id="closeOutsideToggle" checked> 外枠をタップして閉じる</label></div>`,
    'series': `<div id="menu-series" class="menu-section"><h3>表示する弾数</h3><div id="seriesFilterContainer"></div></div>`,
    'settings': `<div id="menu-settings" class="menu-section"><button class="nav-btn" onclick="switchView('settings')" style="border-color: #ff9800; color: #e65100; background: #fff8e1;">チェッカー設定</button></div>`,
    'privacy': `<div id="menu-privacy" class="menu-section"><button class="nav-btn" onclick="switchView('privacy')" style="border-color: #999; color: #777; background: #f0f0f0;">プライバシーポリシー</button></div>`,
    'egao': `<div id="menu-egao" class="menu-section" style="border-bottom: none;"><button id="egaoBtn">笑顔満点ですっ</button><div id="egaoResult"></div></div>`
  };

  const closeBtn = document.getElementById('menuCloseBtn');
  sidebar.innerHTML = '';
  if(closeBtn) sidebar.appendChild(closeBtn);

  let html = "";
  menuConfig.forEach(item => {
    if(sections[item.id]) html += sections[item.id];
  });
  sidebar.insertAdjacentHTML('beforeend', html);

  safeAddListener('detailModeToggle', 'change', (e) => localStorage.setItem('tourmas_detailMode', e.target.checked));
  safeAddListener('closeOutsideToggle', 'change', (e) => localStorage.setItem('tourmas_closeOutside', e.target.checked));
  safeAddListener('privacyToggle', 'change', (e) => { localStorage.setItem('tourmas_privacy', e.target.checked); updateUserInfo(); });
  safeAddListener('loginBtn', 'click', () => signInWithPopup(auth, provider));
  safeAddListener('logoutBtn', 'click', () => signOut(auth));
  
  const egaoBtn = document.getElementById('egaoBtn');
  if(egaoBtn) egaoBtn.addEventListener('click', () => {
    const dai = egaoEffects[Math.floor(Math.random() * egaoEffects.length)];
    const shou = egaoEffects[Math.floor(Math.random() * egaoEffects.length)];
    const resDiv = document.getElementById('egaoResult');
    if(resDiv) { resDiv.innerHTML = `<strong>効果(大)：</strong>${dai}<br><strong>効果(小)：</strong>${shou}<br>`; resDiv.style.display = 'block'; }
  });

  window.setupSeriesFilter();
  window.loadSettings();
};

const getFilterGridHtml = (id) => {
    let html = "";
    let dataArray = [];
    if(id === 'rarity') dataArray = filterConfig.rarities;
    if(id === 'type') dataArray = filterConfig.types;
    if(id === 'brand') dataArray = filterConfig.brands;
    if(id === 'target') dataArray = filterConfig.targets;
    if(id === 'part') dataArray = filterConfig.parts;
    if(id === 'genre') dataArray = filterConfig.genres;
    if(id === 'idol') dataArray = filterConfig.idols;

    dataArray.forEach(item => {
        const value = typeof item === 'object' ? item.name : item;
        html += `<label class="filter-btn-label"><input type="checkbox" class="advanced-filter filter-${id}" value="${value}"> ${value}</label>`;
    });
    return html;
};

window.renderAdvancedFilters = () => {
    const panel = document.getElementById('filterPanelBody');
    if(!panel) return;
    panel.innerHTML = '';
    
    filterConfigGroups.forEach(group => {
        let inner = "";
        if (group.id === 'owned') {
            inner = `
              <label class="filter-btn-label"><input type="radio" name="filterOwned" value="all" checked> すべて表示</label>
              <label class="filter-btn-label"><input type="radio" name="filterOwned" value="owned"> 持っている</label>
              <label class="filter-btn-label"><input type="radio" name="filterOwned" value="unowned"> 持っていない</label>
            `;
        } else if (group.id === 'wish') {
            inner = `
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="0" checked> 指定なし</label>
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="1"> ★1以上</label>
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="2"> ★2以上</label>
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="3"> ★3以上</label>
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="4"> ★4以上</label>
              <label class="filter-btn-label"><input type="radio" name="filterWish" value="5"> ★5のみ</label>
            `;
        } else {
            inner = getFilterGridHtml(group.id);
        }
        
        panel.innerHTML += `
          <details class="filter-group" ${group.open ? 'open' : ''}>
            <summary><h4>${group.label}</h4></summary>
            <div class="filter-grid" id="${group.id}Filters">${inner}</div>
          </details>
        `;
    });
    
    document.querySelectorAll('input[name="filterOwned"]').forEach(r => r.addEventListener('change', window.applyFiltersAndSort));
    document.querySelectorAll('input[name="filterWish"]').forEach(r => r.addEventListener('change', window.applyFiltersAndSort));
    document.querySelectorAll('.advanced-filter').forEach(cb => cb.addEventListener('change', window.applyFiltersAndSort));
};

window.setupSeriesFilter = () => {
  seriesSetForModal.clear();
  let hasToursRare = false;
  let hasUnknown = false;
  cardData.forEach(c => {
    let s = c["シリーズ"] || c["入手手段"];
    if (!s || s === "") {
      hasUnknown = true;
      return;
    }
    if (s.includes("ツアーズレア")) hasToursRare = true;
    else seriesSetForModal.add(s);
  });
  
  const seriesContainer = document.getElementById('seriesFilterContainer');
  if(seriesContainer) {
      seriesContainer.innerHTML = '';
      Array.from(seriesSetForModal).forEach(s => {
        seriesContainer.innerHTML += `<label class="checkbox-label"><input type="checkbox" class="series-filter" value="${s}" checked> ${s}</label>`;
      });
      if (hasToursRare) {
        seriesContainer.innerHTML += `<label class="checkbox-label" style="font-weight:bold; color:var(--main-color);"><input type="checkbox" class="series-filter" value="ツアーズレア" checked> ツアーズレア (全弾一括)</label>`;
      }
      if (hasUnknown) {
        seriesContainer.innerHTML += `<label class="checkbox-label" style="color:#888;"><input type="checkbox" class="series-filter" value="未設定" checked> 未設定（追加予定）</label>`;
      }
      document.querySelectorAll('.series-filter').forEach(cb => cb.addEventListener('change', window.applyFiltersAndSort));
  }

  const msf = document.getElementById('modalFilterSelect');
  if(msf) {
      msf.innerHTML = '<option value="all">すべての弾</option>';
      Array.from(seriesSetForModal).forEach(s => {
        msf.innerHTML += `<option value="${s}">${s}</option>`;
      });
      if (hasToursRare) msf.innerHTML += `<option value="ツアーズレア">ツアーズレア (全弾一括)</option>`;
      if (hasUnknown) msf.innerHTML += `<option value="未設定">未設定</option>`;
  }
};

window.loadSettings = () => {
  let savedTheme = 'default';
  let savedNotice = true;
  let savedDetailMode = true;
  let savedCloseOutside = true;
  let savedPrivacy = false;
  let savedFreeMemo = true;
  let savedNameStyle = 'ellipsis';
  let defaultMode = 'on';

  try {
    savedTheme = localStorage.getItem('tourmas_theme') || 'default';
    savedNotice = localStorage.getItem('tourmas_notice') !== 'false';
    if (localStorage.getItem('tourmas_detailMode') === 'false') savedDetailMode = false;
    if (localStorage.getItem('tourmas_closeOutside') === 'false') savedCloseOutside = false;
    if (localStorage.getItem('tourmas_privacy') === 'true') savedPrivacy = true;
    if (localStorage.getItem('tourmas_freeMemo') === 'false') savedFreeMemo = false;
    savedNameStyle = localStorage.getItem('tourmas_nameStyle') || 'ellipsis';
    defaultMode = localStorage.getItem('tourmas_defaultMode') || 'on';
  } catch(e) {}

  const ts = document.getElementById('themeSelectInSettings');
  if(ts) ts.value = savedTheme;
  applyTheme(savedTheme);
  
  const ns = document.getElementById('nameStyleSelect');
  if(ns) ns.value = savedNameStyle;

  const dms = document.getElementById('defaultModeSelect');
  if(dms) dms.value = defaultMode;

  const nts = document.getElementById('noticeToggleSettings');
  if(nts) nts.checked = savedNotice;
  const mc = document.getElementById('marqueeContainer');
  if(mc) mc.style.display = savedNotice ? 'block' : 'none';
  
  const dm = document.getElementById('detailModeToggle');
  if(dm) {
     if (defaultMode === 'on') {
         dm.checked = true;
         savedDetailMode = true;
     } else if (defaultMode === 'off') {
         dm.checked = false;
         savedDetailMode = false;
     }
     localStorage.setItem('tourmas_detailMode', savedDetailMode);
  }
  
  const co = document.getElementById('closeOutsideToggle');
  if(co) co.checked = savedCloseOutside;
  const pt = document.getElementById('privacyToggle');
  if(pt) pt.checked = savedPrivacy;
  const fm = document.getElementById('freeMemoToggle');
  if(fm) fm.checked = savedFreeMemo;
  updateUserInfo();
};

// ==========================================
// 6. メイン機能（カード表示・フィルタ・ソート）
// ==========================================
window.applyFiltersAndSort = () => {
  const si = document.getElementById('searchInput');
  const text = si ? si.value.toLowerCase() : "";
  const sm = document.querySelector('input[name="searchMode"]:checked');
  const searchMode = sm ? sm.value : "exact";
  
  const fo = document.querySelector('input[name="filterOwned"]:checked');
  const filterOwned = fo ? fo.value : "all";
  const fw = document.querySelector('input[name="filterWish"]:checked');
  const filterWish = fw ? parseInt(fw.value) : 0;
  
  const getChecked = (className) => {
    const checked = Array.from(document.querySelectorAll(`.${className}:checked`)).map(cb => cb.value);
    return checked.length > 0 ? checked : null;
  };

  const checkedRarities = getChecked('filter-rarity');
  const checkedTypes = getChecked('filter-type');
  const checkedBrands = getChecked('filter-brand');
  const checkedTargets = getChecked('filter-target');
  const checkedParts = getChecked('filter-part');
  const checkedGenres = getChecked('filter-genre');
  const checkedIdols = getChecked('filter-idol');
  const checkedSeries = Array.from(document.querySelectorAll('.series-filter:checked')).map(cb => cb.value);
  
  let cardsArray = Array.from(document.querySelectorAll('.card'));
  let visibleCount = 0;
  let ownedVisibleCount = 0;
  let totalCardsCount = 0;

  cardsArray.forEach(card => {
    const searchTarget = (searchMode === 'partial') ? card.dataset.searchPartial : card.dataset.searchExact;
    const matchText = searchTarget.includes(text);
    
    const matchSeries = checkedSeries.some(s => {
       if (s === "ツアーズレア") return card.dataset.series.includes("ツアーズレア");
       return card.dataset.series === s;
    });
    
    const isOwned = card.classList.contains('owned');
    const matchOwned = filterOwned === 'all' || (filterOwned === 'owned' && isOwned) || (filterOwned === 'unowned' && !isOwned);
    const cardWish = parseInt(card.dataset.wish) || 0;
    const matchWish = filterWish === 0 || (filterWish === 5 ? cardWish === 5 : cardWish >= filterWish);

    const matchRarity = !checkedRarities || checkedRarities.includes(card.dataset.rarity);
    const matchType = !checkedTypes || checkedTypes.includes(card.dataset.type);
    const matchBrand = !checkedBrands || checkedBrands.includes(card.dataset.brand);
    const matchTarget = !checkedTargets || checkedTargets.some(t => card.dataset.target.includes(t));
    const matchPart = !checkedParts || checkedParts.includes(card.dataset.part);
    const matchGenre = !checkedGenres || checkedGenres.includes(card.dataset.genre);
    const matchIdol = !checkedIdols || checkedIdols.includes(card.dataset.idol);

    if (matchText && matchSeries && matchRarity && matchType && matchBrand && matchTarget && matchPart && matchGenre && matchIdol && matchOwned && matchWish) {
      card.style.display = 'flex';
      visibleCount++;
      if (isOwned) {
        ownedVisibleCount++;
        const cardId = card.dataset.number;
        const count = userCardDetails[cardId] ? userCardDetails[cardId].count : 1;
        totalCardsCount += count;
      }
    } else {
      card.style.display = 'none';
    }
  });
  
  const ss = document.getElementById('sortSelect');
  const sortKey = ss ? ss.value : 'number';
  const sob = document.getElementById('sortOrderBtn');
  const isAsc = sob ? sob.dataset.order === 'asc' : true;

  cardsArray.sort((a, b) => {
    let valA, valB;
    if (sortKey === 'number') { valA = parseInt(a.dataset.imgNum); valB = parseInt(b.dataset.imgNum); } 
    else if (sortKey === 'wish') { valA = parseInt(a.dataset.wish); valB = parseInt(b.dataset.wish); }
    else if (sortKey === 'vocal' || sortKey === 'dance' || sortKey === 'visual') { valA = parseInt(a.dataset[sortKey]); valB = parseInt(b.dataset[sortKey]); } 
    else if (sortKey === 'rarity') { valA = rarityOrder[a.dataset.rarity] || -1; valB = rarityOrder[b.dataset.rarity] || -1; }
    return isAsc ? valA - valB : valB - valA;
  });

  const container = document.getElementById('cardList');
  if(container) cardsArray.forEach(card => container.appendChild(card));
  const percent = visibleCount === 0 ? 0 : Math.floor((ownedVisibleCount / visibleCount) * 100);
  
  const cd = document.getElementById('counterDisplay');
  if(cd) cd.innerHTML = `所持数: ${ownedVisibleCount} / ${visibleCount}種 (${percent}%) <span id="totalCountDisplay">総枚数: ${totalCardsCount}枚</span>`;
};

window.renderCards = () => {
  const container = document.getElementById('cardList');
  if(!container) return;
  container.innerHTML = '';
  
  const nameStyle = localStorage.getItem('tourmas_nameStyle') || 'ellipsis';
  
  cardData.forEach(data => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    if (ownedCardIds.has(data["番号"])) cardDiv.classList.add('owned');
    
    let imgNum = 99999;
    if (data["カード表"]) {
      cardDiv.style.backgroundImage = `url('images/${data["カード表"]}')`;
      cardDiv.style.backgroundSize = 'cover';
      const match = data["カード表"].match(/\d+/);
      if (match) imgNum = parseInt(match[0]);
    }

    const uData = userCardDetails[data["番号"]] || { count: 0, memo: "", wish: 0 };
    const wishStars = uData.wish > 0 ? `<div class="wish-star">${'★'.repeat(uData.wish)}</div>` : '';

    cardDiv.dataset.number = data["番号"];
    cardDiv.dataset.imgNum = imgNum;
    cardDiv.dataset.vocal = parseInt(data["アピール値（Vocal)"]) || 0;
    cardDiv.dataset.dance = parseInt(data["アピール値（Dance）"]) || 0;
    cardDiv.dataset.visual = parseInt(data["アピール値（Visual）"]) || 0;
    cardDiv.dataset.wish = uData.wish || 0;
    cardDiv.dataset.rarity = data["レアリティ"] || "";
    cardDiv.dataset.type = data["種類"] || "";
    cardDiv.dataset.brand = data["シリーズブランド名"] || "";
    cardDiv.dataset.idol = data["アイドル名"] || "";
    cardDiv.dataset.series = data["シリーズ"] || data["入手手段"] || "未設定";
    cardDiv.dataset.target = data["対象アイドル／サポート効果対象"] || "";
    cardDiv.dataset.part = data["部位"] || "";
    cardDiv.dataset.genre = data["ジャンル"] || ""; 

    const commentData = data["キャラコメント"] || data["コメント"] || "";
    const exactKeywords = [data["アイドル名"], data["カード名"], data["番号"], data["シリーズブランド名"]].join(" ").toLowerCase();
    
    const partialKeywords = exactKeywords + " " + [
      data["レアリティ"], data["種類"], data["ジャンル"],
      data["写り込み"], data["タグ"], data["対象アイドル／サポート効果対象"], data["部位"], commentData, data["セットボーナス"]
    ].join(" ").toLowerCase();
    
    cardDiv.dataset.searchExact = exactKeywords;
    cardDiv.dataset.searchPartial = partialKeywords;
    
    const mainText = data["カード名"] || data["番号"] || "未登録";
    let subText = "";
    if (data["アイドル名"]) {
        subText = `<p>${data["アイドル名"]}</p>`;
    } else if (data["シリーズブランド名"]) {
        subText = `<p>${data["シリーズブランド名"]}</p>`;
    }
    
    let h4Class = "";
    const len = mainText.length;
    if (len >= 11) {
        if (nameStyle === 'marquee') h4Class = 'class="marquee-text"';
        else if (nameStyle === 'shrink') {
            if (len >= 16) h4Class = 'class="shrink-text-sm"';
            else if (len >= 13) h4Class = 'class="shrink-text-md"';
            else h4Class = 'class="shrink-text-lg"';
        }
    }
    
    cardDiv.innerHTML = `${wishStars}<div class="rarity-badge">${data["レアリティ"]}</div><div class="card-info"><h4 ${h4Class}>${mainText}</h4>${subText}</div>`;
    
    cardDiv.onclick = async () => {
      const dmt = document.getElementById('detailModeToggle');
      const isDetailMode = dmt ? dmt.checked : true;
      if (isDetailMode) {
        window.openModal(data);
      } else {
        if (ownedCardIds.has(data["番号"])) {
          ownedCardIds.delete(data["番号"]);
          cardDiv.classList.remove('owned');
          if (userCardDetails[data["番号"]]) userCardDetails[data["番号"]].count = 0;
        } else {
          ownedCardIds.add(data["番号"]);
          cardDiv.classList.add('owned');
          if (!userCardDetails[data["番号"]]) userCardDetails[data["番号"]] = { count: 1, memo: "", wish: 0 };
          else userCardDetails[data["番号"]].count = 1;
        }
        window.applyFiltersAndSort();
        window.markAsUnsaved(); 
      }
    };
    container.appendChild(cardDiv);
  });
  window.applyFiltersAndSort();
};

// ==========================================
// 7. 詳細モーダル機能
// ==========================================
window.updateLocalMemory = () => {
  if (!currentModalCardData) return;
  const countEl = document.getElementById('modalCount');
  const wishEl = document.getElementById('modalWish');
  const memoEl = document.getElementById('modalMemo');
  
  const countVal = countEl ? parseInt(countEl.value) || 0 : 0;
  const wishVal = wishEl ? parseInt(wishEl.value) || 0 : 0;
  const memoVal = memoEl ? memoEl.value : "";
  const cardId = currentModalCardData["番号"];
  
  if (countVal > 0) ownedCardIds.add(cardId);
  else ownedCardIds.delete(cardId);
  
  userCardDetails[cardId] = { count: countVal, memo: memoVal, wish: wishVal };
  window.markAsUnsaved();
  window.renderCards(); 
};

window.openModal = (data) => {
  currentModalCardData = data;
  const imgFront = document.getElementById('modalImgFront');
  const imgBack = document.getElementById('modalImgBack');
  if (data["カード表"] && imgFront) { imgFront.src = `images/${data["カード表"]}`; imgFront.style.display = 'block'; } else if(imgFront) { imgFront.style.display = 'none'; }
  if (data["カード裏"] && imgBack) { imgBack.src = `images/${data["カード裏"]}`; imgBack.style.display = 'block'; } else if(imgBack) { imgBack.style.display = 'none'; }
  
  const nameEl = document.getElementById('modalCardName');
  const idolEl = document.getElementById('modalCardIdol');
  if(nameEl) nameEl.innerText = data["カード名"] || data["番号"] || "名称不明";
  if(idolEl) idolEl.innerText = `${data["シリーズブランド名"]} / ${data["アイドル名"]}`;
  
  const table = document.getElementById('modalTable');
  if(table) table.innerHTML = '';
  
  const createCardLinks = (idsString, displayType) => {
    if (!idsString) return '';
    const ids = idsString.split(',').map(id => id.trim()).filter(id => id !== '');
    if (ids.length === 0) return '';
    let html = '';
    ids.forEach(id => {
      const targetCard = cardData.find(c => c["番号"] === id);
      if (targetCard) {
        const btnText = displayType === 'name' ? (targetCard["カード名"] || id) : id;
        html += `<button class="card-link-btn" data-target-id="${id}">${btnText}</button>`;
      } else {
        html += `<button class="card-link-btn disabled" disabled>${id} (未登録)</button>`;
      }
    });
    return html;
  };

  if(table) {
    modalConfig.forEach(item => {
      if (!item.show) return;
      
      let val = "";
      if (item.id === 'number') val = data["番号"];
      else if (item.id === 'rarity') val = data["レアリティ"];
      else if (item.id === 'type') val = data["種類"];
      else if (item.id === 'genre') val = data["ジャンル"];
      else if (item.id === 'appeal') {
        const v = data["アピール値（Vocal)"] || 0; const d = data["アピール値（Dance）"] || 0; const vi = data["アピール値（Visual）"] || 0;
        if (v||d||vi) val = `<span style="color:#e91e63">Vo: ${v}</span> / <span style="color:#2196f3">Da: ${d}</span> / <span style="color:#ffc107">Vi: ${vi}</span>`;
      }
      else if (item.id === 'target') val = data["対象アイドル／サポート効果対象"];
      else if (item.id === 'part') val = data["部位"];
      else if (item.id === 'effect') val = data["サポート効果／リズムライブ効果"];
      else if (item.id === 'note') val = (data["備考"] || "").replace(/,/g, '<br>');
      else if (item.id === 'relax') val = data["制限緩和"];
      else if (item.id === 'comment') val = data["キャラコメント"] || data["コメント"];
      else if (item.id === 'series') val = data["シリーズ"] || data["入手手段"];
      else if (item.id === 'bonus') {
        if (data["セットボーナス"]) val = `<button class="card-link-btn set-bonus-link" data-bonus="${data["セットボーナス"]}">${data["セットボーナス"]}</button>`;
      }
      else if (item.id === 'altcard') val = createCardLinks(data["別カード"] || data["別イラスト"], 'id');
      else if (item.id === 'color') val = createCardLinks(data["色違い"], 'name');
      else if (item.id === 'utsurikomi') val = (data["写り込み"] || "").replace(/,/g, '、');

      if (val && val !== "") {
        table.innerHTML += `<tr><th>${item.label}</th><td>${val}</td></tr>`;
      }
    });
  }
  
  const userDetail = userCardDetails[data["番号"]] || { count: (ownedCardIds.has(data["番号"]) ? 1 : 0), memo: "", wish: 0 };
  const mCount = document.getElementById('modalCount');
  const mWish = document.getElementById('modalWish');
  const mMemo = document.getElementById('modalMemo');
  if(mCount) mCount.value = userDetail.count;
  if(mWish) mWish.value = userDetail.wish;
  if(mMemo) mMemo.value = userDetail.memo;
  
  const detailModal = document.getElementById('detailModal');
  if(detailModal) detailModal.classList.add('open');

  if(table) {
    const linkBtns = table.querySelectorAll('.card-link-btn:not(.disabled):not(.set-bonus-link)');
    linkBtns.forEach(btn => {
      btn.onclick = () => {
        const targetId = btn.dataset.targetId;
        const targetData = cardData.find(c => c["番号"] === targetId);
        if (targetData) {
          window.updateLocalMemory(); 
          window.openModal(targetData); 
        }
      };
    });

    const bonusBtns = table.querySelectorAll('.set-bonus-link');
    bonusBtns.forEach(btn => {
      btn.onclick = () => {
        window.updateLocalMemory();
        if(detailModal) detailModal.classList.remove('open');
        window.switchView('collection');
        const sm = document.querySelector('input[name="searchMode"][value="partial"]');
        if(sm) sm.checked = true;
        const si = document.getElementById('searchInput');
        if(si) si.value = btn.dataset.bonus;
        window.applyFiltersAndSort();
      };
    });
  }
};

const modalCloseBtn = document.getElementById('modalCloseBtn');
if(modalCloseBtn) modalCloseBtn.onclick = () => document.getElementById('detailModal')?.classList.remove('open');
const detailModalEl = document.getElementById('detailModal');
if(detailModalEl) {
  detailModalEl.addEventListener('click', (e) => {
    const co = document.getElementById('closeOutsideToggle');
    if (e.target === detailModalEl && co && co.checked) {
      detailModalEl.classList.remove('open');
    }
  });
}

// ==========================================
// 8. 各種設定のリセットと並べ替え
// ==========================================
window.resetModalSettings = () => {
    modalConfig = JSON.parse(JSON.stringify(defaultModalItems));
    localStorage.setItem('tourmas_modalConfig', JSON.stringify(modalConfig));
    window.renderModalOrderSettings();
};

window.renderModalOrderSettings = () => {
  const container = document.getElementById('modalOrderSettingsContainer');
  if(!container) return;
  container.innerHTML = '';
  modalConfig.forEach((item, index) => {
    container.innerHTML += `
      <div class="settings-list-item">
        <button onclick="moveModalItem(${index}, -1)" style="margin-right:5px;" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button onclick="moveModalItem(${index}, 1)" style="margin-right:15px;" ${index === modalConfig.length - 1 ? 'disabled' : ''}>▼</button>
        <label style="flex:1; cursor:pointer; font-size:14px; font-weight:bold; color:#333;">
          <input type="checkbox" style="transform:scale(1.2); margin-right:8px;" onchange="toggleModalItem(${index}, this.checked)" ${item.show ? 'checked' : ''}>
          ${item.label}
        </label>
      </div>
    `;
  });
};

window.moveModalItem = (index, dir) => {
  const temp = modalConfig[index];
  modalConfig[index] = modalConfig[index + dir];
  modalConfig[index + dir] = temp;
  localStorage.setItem('tourmas_modalConfig', JSON.stringify(modalConfig));
  window.renderModalOrderSettings();
};

window.toggleModalItem = (index, show) => {
  modalConfig[index].show = show;
  localStorage.setItem('tourmas_modalConfig', JSON.stringify(modalConfig));
};

window.resetMenuSettings = () => {
    menuConfig = JSON.parse(JSON.stringify(defaultMenuItems));
    localStorage.setItem('tourmas_menuConfig', JSON.stringify(menuConfig));
    window.renderMenuOrderSettings();
    window.renderSidebarMenu();
};

window.renderMenuOrderSettings = () => {
  const container = document.getElementById('menuOrderSettingsContainer');
  if(!container) return;
  container.innerHTML = '';
  menuConfig.forEach((item, index) => {
    container.innerHTML += `
      <div class="settings-list-item">
        <button onclick="moveMenuItem(${index}, -1)" style="margin-right:5px;" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button onclick="moveMenuItem(${index}, 1)" style="margin-right:15px;" ${index === menuConfig.length - 1 ? 'disabled' : ''}>▼</button>
        <span style="flex:1; font-size:14px; font-weight:bold; color:#333;">${item.label}</span>
      </div>
    `;
  });
};

window.moveMenuItem = (index, dir) => {
  const temp = menuConfig[index];
  menuConfig[index] = menuConfig[index + dir];
  menuConfig[index + dir] = temp;
  localStorage.setItem('tourmas_menuConfig', JSON.stringify(menuConfig));
  window.renderMenuOrderSettings();
  window.renderSidebarMenu();
};

window.resetFilterSettings = () => {
    filterConfigGroups = JSON.parse(JSON.stringify(defaultFilterGroups));
    localStorage.setItem('tourmas_filterConfig', JSON.stringify(filterConfigGroups));
    window.renderFilterOrderSettings();
    window.renderAdvancedFilters();
};

window.renderFilterOrderSettings = () => {
  const container = document.getElementById('filterOrderSettingsContainer');
  if(!container) return;
  container.innerHTML = '';
  filterConfigGroups.forEach((group, index) => {
    container.innerHTML += `
      <div class="settings-list-item">
        <button onclick="moveFilterItem(${index}, -1)" style="margin-right:5px;" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button onclick="moveFilterItem(${index}, 1)" style="margin-right:15px;" ${index === filterConfigGroups.length - 1 ? 'disabled' : ''}>▼</button>
        <label style="flex:1; cursor:pointer; font-size:14px; font-weight:bold; color:#333;">
          <input type="checkbox" style="transform:scale(1.2); margin-right:8px;" onchange="toggleFilterOpen(${index}, this.checked)" ${group.open ? 'checked' : ''}>
          ${group.label} (最初から開く)
        </label>
      </div>
    `;
  });
};

window.moveFilterItem = (index, dir) => {
  const temp = filterConfigGroups[index];
  filterConfigGroups[index] = filterConfigGroups[index + dir];
  filterConfigGroups[index + dir] = temp;
  localStorage.setItem('tourmas_filterConfig', JSON.stringify(filterConfigGroups));
  window.renderFilterOrderSettings();
  window.renderAdvancedFilters();
};

window.toggleFilterOpen = (index, openStatus) => {
  filterConfigGroups[index].open = openStatus;
  localStorage.setItem('tourmas_filterConfig', JSON.stringify(filterConfigGroups));
  window.renderAdvancedFilters();
};

// ==========================================
// 9. マイ編成メモ機能
// ==========================================
window.updateFormationData = (index, field, subfield, value) => {
  if (subfield) {
    if (!userFormations[index][field]) userFormations[index][field] = {};
    userFormations[index][field][subfield] = value;
  } else {
    userFormations[index][field] = value;
  }
  window.markAsUnsaved();
};

window.deleteFormation = (index) => {
  if(confirm("この編成を削除しますか？")) {
    userFormations.splice(index, 1);
    window.renderFormations();
    window.markAsUnsaved();
  }
};

window.addFormation = () => {
  userFormations.push({
    name: "新しい編成", songAttr: "指定なし", isOpen: true,
    idol1: {}, idol2: {}, idol3: {},
    sp1: "", sp2: "", sp3: "", sup1: "", sup2: "", sup3: "", memo: ""
  });
  window.renderFormations();
  window.markAsUnsaved();
};

window.toggleFormationBody = (idx) => {
  if (userFormations[idx].isOpen === undefined) userFormations[idx].isOpen = true;
  userFormations[idx].isOpen = !userFormations[idx].isOpen;
  window.renderFormations();
  window.markAsUnsaved();
};

window.renderFormations = () => {
  const container = document.getElementById('formationListContainer');
  if(!container) return;
  container.innerHTML = '';
  
  if(userFormations.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#999; margin:30px 0;">まだ編成が登録されていません。<br>下の「＋」ボタンから追加してください。</p>';
    return;
  }

  const fmToggle = document.getElementById('freeMemoToggle');
  const showMemo = fmToggle ? fmToggle.checked : true;

  userFormations.forEach((f, idx) => {
    const isOpen = f.isOpen !== false; 
    const div = document.createElement('div');
    div.className = 'formation-card';
    
    const createIdolCol = (idolKey, title) => {
      const selectedName = f[idolKey]?.name || '';
      return `
      <div class="formation-col">
        <h4>${title}</h4>
        <div class="f-row"><label>アイドル</label><input type="text" value="${selectedName}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'name')" placeholder="タップして選択"></div>
        <div class="f-row"><label>衣装</label><input type="text" value="${f[idolKey]?.costume || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'costume')" placeholder="タップして選択"></div>
        <div class="f-row"><label>頭アクセ</label><input type="text" value="${f[idolKey]?.head || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'head')" placeholder="タップして選択"></div>
        <div class="f-row"><label>顔アクセ</label><input type="text" value="${f[idolKey]?.face || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'face')" placeholder="タップして選択"></div>
        <div class="f-row"><label>手アクセ</label><input type="text" value="${f[idolKey]?.hand || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'hand')" placeholder="タップして選択"></div>
        <div class="f-row"><label>胴アクセ</label><input type="text" value="${f[idolKey]?.body || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'body')" placeholder="タップして選択"></div>
        <div class="f-row"><label>腰アクセ</label><input type="text" value="${f[idolKey]?.waist || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'waist')" placeholder="タップして選択"></div>
        <div class="f-row"><label>脚アクセ</label><input type="text" value="${f[idolKey]?.leg || ''}" readonly onclick="openSelectModal(${idx}, '${idolKey}', 'leg')" placeholder="タップして選択"></div>
      </div>
      `;
    };

    div.innerHTML = `
      <div class="formation-header">
        <input type="text" value="${f.name}" oninput="updateFormationData(${idx}, 'name', null, this.value)" placeholder="編成の名前 (例：Vo特化編成)">
        <select onchange="updateFormationData(${idx}, 'songAttr', null, this.value)">
          <option value="指定なし" ${f.songAttr==='指定なし'?'selected':''}>属性: 指定なし</option>
          <option value="Vo" ${f.songAttr==='Vo'?'selected':''}>Vo (ボーカル)</option>
          <option value="Da" ${f.songAttr==='Da'?'selected':''}>Da (ダンス)</option>
          <option value="Vi" ${f.songAttr==='Vi'?'selected':''}>Vi (ビジュアル)</option>
          <option value="VoDa" ${f.songAttr==='VoDa'?'selected':''}>Vo.Da</option>
          <option value="VoVi" ${f.songAttr==='VoVi'?'selected':''}>Vo.Vi</option>
          <option value="DaVi" ${f.songAttr==='DaVi'?'selected':''}>Da.Vi</option>
          <option value="VoDaVi" ${f.songAttr==='VoDaVi'?'selected':''}>Vo.Da.Vi</option>
        </select>
        <button class="toggle-formation-btn" onclick="toggleFormationBody(${idx})">${isOpen ? '▲ 閉じる' : '▼ 開く'}</button>
        <button class="delete-formation-btn" onclick="deleteFormation(${idx})">削除</button>
      </div>
      
      <div class="formation-body" style="display: ${isOpen ? 'block' : 'none'};">
        <div class="formation-grid">
          ${createIdolCol('idol1', '左ポジション')}
          ${createIdolCol('idol2', 'センター')}
          ${createIdolCol('idol3', '右ポジション')}
        </div>
        
        <div class="formation-bottom">
          <div class="f-box">
            <h4>SPアピール配置</h4>
            <div class="f-row"><label>左 (1)</label><input type="text" value="${f.sp1 || ''}" readonly onclick="openSelectModal(${idx}, 'sp1', null)" placeholder="タップして選択"></div>
            <div class="f-row"><label>中央(2)</label><input type="text" value="${f.sp2 || ''}" readonly onclick="openSelectModal(${idx}, 'sp2', null)" placeholder="タップして選択"></div>
            <div class="f-row"><label>右 (3)</label><input type="text" value="${f.sp3 || ''}" readonly onclick="openSelectModal(${idx}, 'sp3', null)" placeholder="タップして選択"></div>
          </div>
          
          <div class="f-box support">
            <h4>サポートカード配置</h4>
            <div class="f-row">
              <label>左枠</label><input type="text" value="${f.sup1 || ''}" readonly onclick="openSelectModal(${idx}, 'sup1', null)" placeholder="タップして選択">
            </div>
            <span class="f-note">※制限: SR, TSR, CO, R, TR, N</span>
            
            <div class="f-row">
              <label>中央枠</label><input type="text" value="${f.sup2 || ''}" readonly onclick="openSelectModal(${idx}, 'sup2', null)" placeholder="タップして選択">
            </div>
            <span class="f-note" style="color:#1a73e8;">※制限なし (全レアリティ可)</span>
            
            <div class="f-row">
              <label>右枠</label><input type="text" value="${f.sup3 || ''}" readonly onclick="openSelectModal(${idx}, 'sup3', null)" placeholder="タップして選択">
            </div>
            <span class="f-note">※制限: R, TR, N</span>
          </div>
        </div>
        
        <div class="f-box" style="margin-top:15px; display: ${showMemo ? 'block' : 'none'}">
          <h4>自由メモ</h4>
          <textarea style="width:100%; height:60px; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" oninput="updateFormationData(${idx}, 'memo', null, this.value)" placeholder="立ち回りやカードの代用案など...">${f.memo || ''}</textarea>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
};

window.renderSelectModalList = () => {
  if(!currentSelectTarget) return;
  const { idx, field, subfield } = currentSelectTarget;
  const list = document.getElementById('cardSelectList');
  if(!list) return;
  list.innerHTML = '';
  
  const msf = document.getElementById('modalFilterSelect');
  const selectedFilter = msf ? msf.value : "all";

  if (currentSelectMode === 'idol') {
      let idolArray = Array.from(idolBrandMap.keys()).map(name => ({
          name: name,
          brand: idolBrandMap.get(name)
      }));
      
      idolArray.sort((a, b) => {
          let aBrandIdx = filterConfig.brands.indexOf(a.brand);
          let bBrandIdx = filterConfig.brands.indexOf(b.brand);
          if (aBrandIdx === -1) aBrandIdx = 999;
          if (bBrandIdx === -1) bBrandIdx = 999;
          if (aBrandIdx !== bBrandIdx) return aBrandIdx - bBrandIdx;
          
          let aIdolIdx = filterConfig.idols.findIndex(i => i.name === a.name);
          let bIdolIdx = filterConfig.idols.findIndex(i => i.name === b.name);
          if (aIdolIdx === -1) aIdolIdx = 999;
          if (bIdolIdx === -1) bIdolIdx = 999;
          return aIdolIdx - bIdolIdx;
      });

      idolArray.forEach(idol => {
          const brand = idol.brand;
          const idolName = idol.name;
          if (selectedFilter !== "all" && brand !== selectedFilter) return;
          
          const cardDiv = document.createElement('div');
          cardDiv.className = 'idol-badge';
          
          cardDiv.innerHTML = `<p>${brand}</p><h4>${idolName}</h4>`;
          
          cardDiv.onclick = () => {
              window.updateFormationData(idx, field, subfield, idolName);
              document.getElementById('cardSelectModal')?.classList.remove('open');
              window.renderFormations();
          };
          list.appendChild(cardDiv);
      });
      return;
  }

  let filterType = ""; let filterPart = ""; let filterRarities = null;
  if (subfield === 'costume') filterType = "コスチューム";
  else if (subfield === 'head') { filterType = "アクセサリー"; filterPart = "頭"; }
  else if (subfield === 'face') { filterType = "アクセサリー"; filterPart = "顔"; }
  else if (subfield === 'hand') { filterType = "アクセサリー"; filterPart = "手"; }
  else if (subfield === 'body') { filterType = "アクセサリー"; filterPart = "胴"; }
  else if (subfield === 'waist') { filterType = "アクセサリー"; filterPart = "腰"; }
  else if (subfield === 'leg') { filterType = "アクセサリー"; filterPart = "脚"; }
  else if (field.startsWith('sp')) filterType = "SPアピール";
  else if (field === 'sup1') { filterType = "サポート"; filterRarities = ["SR", "TSR", "CO", "R", "TR", "N"]; }
  else if (field === 'sup2') { filterType = "サポート"; }
  else if (field === 'sup3') { filterType = "サポート"; filterRarities = ["R", "TR", "N"]; }
  
  const nameStyle = localStorage.getItem('tourmas_nameStyle') || 'ellipsis';
  
  cardData.forEach(data => {
    if (filterType && data["種類"] !== filterType) return;
    if (filterPart && data["部位"] !== filterPart) return;
    if (filterRarities && !filterRarities.includes(data["レアリティ"])) return;
    
    const s = data["シリーズ"] || data["入手手段"] || "未設定";
    if (selectedFilter !== "all") {
       if (selectedFilter === "ツアーズレア") {
         if (!s.includes("ツアーズレア")) return;
       } else {
         if (s !== selectedFilter) return;
       }
    }
    
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    if (data["カード表"]) {
      cardDiv.style.backgroundImage = `url('images/${data["カード表"]}')`;
      cardDiv.style.backgroundSize = 'cover';
    }
    
    const mainText = data["カード名"] || data["番号"] || "未登録";
    let subText = "";
    if (data["アイドル名"]) {
        subText = `<p>${data["アイドル名"]}</p>`;
    } else if (data["シリーズブランド名"]) {
        subText = `<p>${data["シリーズブランド名"]}</p>`;
    }
    
    let h4Class = "";
    const len = mainText.length;
    if (len >= 11) {
        if (nameStyle === 'marquee') h4Class = 'class="marquee-text"';
        else if (nameStyle === 'shrink') {
            if (len >= 16) h4Class = 'class="shrink-text-sm"';
            else if (len >= 13) h4Class = 'class="shrink-text-md"';
            else h4Class = 'class="shrink-text-lg"';
        }
    }
    
    cardDiv.innerHTML = `<div class="rarity-badge">${data["レアリティ"]}</div><div class="card-info"><h4 ${h4Class}>${mainText}</h4>${subText}</div>`;
    
    cardDiv.onclick = () => {
      const val = `[${data["レアリティ"]}] ${mainText}`;
      window.updateFormationData(idx, field, subfield, val);
      document.getElementById('cardSelectModal')?.classList.remove('open');
      window.renderFormations();
    };
    list.appendChild(cardDiv);
  });
};

window.openSelectModal = (idx, field, subfield) => {
  currentSelectTarget = { idx, field, subfield };
  const msf = document.getElementById('modalFilterSelect');
  const st = document.getElementById('cardSelectTitle');

  if (subfield === 'name') {
      currentSelectMode = 'idol';
      if(st) st.innerText = "アイドルを選択";
      if(msf) {
          msf.innerHTML = '<option value="all">すべてのブランド</option>';
          filterConfig.brands.forEach(b => msf.innerHTML += `<option value="${b}">${b}</option>`);
      }
  } 
  else {
      currentSelectMode = 'card';
      let title = "カードを選択";
      if (subfield === 'costume') title = "衣装を選択";
      else if (subfield === 'head') title = "頭アクセを選択";
      else if (subfield === 'face') title = "顔アクセを選択";
      else if (subfield === 'hand') title = "手アクセを選択";
      else if (subfield === 'body') title = "胴アクセを選択";
      else if (subfield === 'waist') title = "腰アクセを選択";
      else if (subfield === 'leg') title = "脚アクセを選択";
      else if (field.startsWith('sp')) title = "SPアピールを選択";
      else if (field === 'sup1') title = "左サポートを選択";
      else if (field === 'sup2') title = "中央サポートを選択";
      else if (field === 'sup3') title = "右サポートを選択";
      
      if(st) st.innerText = title;
      if(msf) {
          msf.innerHTML = '<option value="all">すべての弾</option>';
          let hasToursRare = false;
          Array.from(seriesSetForModal).forEach(s => {
              if(s.includes("ツアーズレア")) hasToursRare = true;
              else msf.innerHTML += `<option value="${s}">${s}</option>`;
          });
          if (hasToursRare) msf.innerHTML += `<option value="ツアーズレア">ツアーズレア (全弾一括)</option>`;
          msf.innerHTML += `<option value="未設定">未設定</option>`;
      }
  }
  
  if(msf) msf.value = "all"; 
  window.renderSelectModalList();
  document.getElementById('cardSelectModal')?.classList.add('open');
};

safeAddListener('modalFilterSelect', 'change', () => {
  window.renderSelectModalList();
});

const csCloseBtn = document.getElementById('cardSelectCloseBtn');
if(csCloseBtn) {
  csCloseBtn.onclick = () => {
    document.getElementById('cardSelectModal')?.classList.remove('open');
  };
}

const csClearBtn = document.getElementById('cardSelectClearBtn');
if(csClearBtn) {
  csClearBtn.onclick = () => {
    if (currentSelectTarget) {
      window.updateFormationData(currentSelectTarget.idx, currentSelectTarget.field, currentSelectTarget.subfield, "");
      window.renderFormations();
    }
    document.getElementById('cardSelectModal')?.classList.remove('open');
  };
}

safeAddListener('modalCount', 'change', window.updateLocalMemory);
safeAddListener('modalWish', 'change', window.updateLocalMemory);
let memoTimeout;
safeAddListener('modalMemo', 'input', () => {
  clearTimeout(memoTimeout);
  memoTimeout = setTimeout(window.updateLocalMemory, 500); 
});

const sortOrderBtn = document.getElementById('sortOrderBtn');
if(sortOrderBtn) {
  sortOrderBtn.addEventListener('click', () => {
    if (sortOrderBtn.dataset.order === 'asc') { sortOrderBtn.dataset.order = 'desc'; sortOrderBtn.innerText = "降順 ▼"; } 
    else { sortOrderBtn.dataset.order = 'asc'; sortOrderBtn.innerText = "昇順 ▲"; }
    window.applyFiltersAndSort();
  });
}

const menuOpenBtn = document.getElementById('menuOpenBtn');
if(menuOpenBtn) menuOpenBtn.onclick = () => { document.getElementById('sidebar')?.classList.add('open'); document.getElementById('overlay')?.classList.add('open'); };
const closeMenu = () => { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('overlay')?.classList.remove('open'); };
const menuCloseBtn = document.getElementById('menuCloseBtn');
if(menuCloseBtn) menuCloseBtn.onclick = closeMenu;
const overlay = document.getElementById('overlay');
if(overlay) overlay.onclick = closeMenu;

const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

// ==========================================
// 10. メイン初期化処理
// ==========================================
onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  
  if (user) {
    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      ownedCardIds = new Set(docSnap.data().ownedCards || []);
      userCardDetails = docSnap.data().cardDetails || {};
      userFormations = docSnap.data().formations || []; 
    } else {
      ownedCardIds = new Set();
      userCardDetails = {};
      userFormations = [];
    }
  } else {
    ownedCardIds = new Set();
    userCardDetails = {};
    userFormations = [];
  }
  
  window.renderSidebarMenu(); 
  window.renderAdvancedFilters();
  loadSettings(); 
  window.renderCards();
  window.renderFormations(); 
  
  if(loginBtn) loginBtn.style.display = user ? 'none' : 'inline-block';
  if(logoutBtn) logoutBtn.style.display = user ? 'inline-block' : 'none';
  
  document.querySelectorAll('.cloud-save-btn').forEach(btn => {
     btn.style.display = user ? 'inline-block' : 'none';
  });
});