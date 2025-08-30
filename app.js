/* CLEANED VERSION NOTE:
- Removed unused/duplicate functions:
    1) routeWhiteTo (unused)
    2) Duplicate onSilverDieClick (kept the full version; removed the minimal one that only armed on +1)
    3) Duplicate rowBonusLabel (kept the short O/P labels; removed the long text version)
- No functional logic otherwise changed.
*/


/* Clever (PWA) – Solo MVP v0.2
   - Vakaa nopan valinta (delegointi) ja chosenDie-asetus kaikille väreille
   - Paneelien klikkaukset delegoitu koko pistetaulukkoon
   - +1-tila: klikkaa suoraan hopealautasen noppaa (ei promptia)
   - Pieni debug-help: statusviestit ja selkeä tehtävänkulku
*/

const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];

const DICE_COLORS = ["white","yellow","blue","green","orange","purple"];
const COLOR_LABELS = {
  white: "Valkoinen",
  yellow: "Keltainen",
  blue: "Sininen",
  green: "Vihreä",
  orange: "Oranssi",
  purple: "Violetti"
};

const ROUNDS_TOTAL = 6;
const PICKS_PER_ROUND = 3;

const state = {
  round: 1,
  pick: 0,
  rerolls: 2,
  plusOnes: 2,
  hasRolledThisPick: false, // onko tämän valinnan ilmainen heitto jo käytetty

  // +1-tila: kun true, hopealautasen noppaa klikkaamalla käytetään +1
  plusOneArmed: false,

  dice: [],           // {color, value, alive, inSilver}
  silver: [],         // viittaukset dice-olioihin, jotka ovat hopealautasella
  lastRollStamp: 0,
  chosenDie: null,    // {die, area}

  sheet: {
    yellow: { grid: [], marked: new Set() },
    blue:   { marked: {} },                   // {2:true,...}
    green:  { idx: 0, thresholds: [] },
    orange: { idx: 0, values: Array(10).fill(null), x2:[2,6] },
    purple: { idx: 0, values: Array(10).fill(null) }
  }
};

// ---------- INIT ----------
window.addEventListener("load", () => {
  initPWA();
  newGame();
  bindUI();
});

function initPWA(){
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
}

// ---------- GAME SETUP ----------
function newGame(){
  state.round = 1;
  state.pick = 0;
  state.rerolls = 2;
  state.plusOnes = 2;
  state.plusOneArmed = false;
  resetDice();
  setupYellowGrid();
  setupBlueTrack();
  setupGreenRow();
  setupOrangeRow();
  setupPurpleRow();
  state.silver = [];
  state.chosenDie = null;
  clearYellowHighlights();
  state.hasRolledThisPick = false;
  renderAll();


  setStatus("Uusi peli aloitettu. Heitä nopat ja valitse 1.");
}

function nextRound(){
  state.round++;
  state.pick = 0;
  state.silver = [];
  state.chosenDie = null;
  state.plusOneArmed = false;
  resetDice();
  clearYellowHighlights();
  renderAll();
  state.hasRolledThisPick = false;
  updateHUD();
  setStatus(`Kierros ${state.round}/${ROUNDS_TOTAL}. Heitä ja valitse 1.`);
}

function resetDice(){
  state.dice = DICE_COLORS.map(c => ({
    color:c, value:null, alive:true, inSilver:false
  }));
}

// ---------- SHEET BUILD ----------
function setupYellowGrid(){
  // --- UUSI: valitse diagonaali ---
  const DIAGONAL_PREFILL = "main"; // "main" | "anti" | "random"

  let diag;
  if (DIAGONAL_PREFILL === "random") {
    diag = (Math.random() < 0.5) ? [0,5,10,15] : [3,6,9,12];
  } else if (DIAGONAL_PREFILL === "anti") {
    diag = [3,6,9,12];
  } else {
    diag = [0,5,10,15]; // default: päädiagonaali
  }

  // Ei-diagonaaliset indeksit
  const allIdx = Array.from({length:16}, (_,i)=>i);
  const nonDiag = allIdx.filter(i => !diag.includes(i));

  // --- UUSI: Rakenna tasajakaumapooli 1–6, kukin 2 kpl (12 kpl yhteensä) ---
  const pool = [];
  for (let n = 1; n <= 6; n++) { pool.push(n, n); } // 12 kpl

  // Sekoita pooli (Fisher–Yates)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // --- Täytä grid: diagonaaleille placeholder (null) / X näkyviin, muille numerot poolista ---
  const arr = Array(16).fill(null);
  nonDiag.forEach((idx, k) => {
    arr[idx] = pool[k]; // 1–6, kukin tasan 2 krt
  });
  // diag-indekseissä jätetään arr[idx] = null (ei numeroa; nämä ovat esitäytettyjä X-ruutuja)

  // Tallenna stateen
  state.sheet.yellow.grid = arr;
  state.sheet.yellow.marked = new Set();

  const wrap = qs("#yellow-grid");
  wrap.innerHTML = "";

  // Luo solut
  allIdx.forEach((idx) => {
    const div = document.createElement("div");
    div.className = "cell";
    div.dataset.idx = idx;

    if (diag.includes(idx)) {
      // --- Diagonaali: esitäytetty X ---
      div.textContent = "X";
      div.classList.add("marked");
      div.setAttribute("aria-checked", "true");
      state.sheet.yellow.marked.add(idx); // data: esitäytetty
    } else {
      // --- Muut ruudut: tasajakaumasta arvottu numero ---
      div.textContent = String(arr[idx]); // 1–6
    }

    // ÄLÄ lisää elementtikohtaista listeneriä — delegointi .sheetissä
    wrap.appendChild(div);
  });

  // Talleta diagonaali pistelaskua varten (jotta se voidaan jättää huomioimatta)
  state.sheet.yellow.prefilledDiag = diag.slice();

  // Piirrä/päivitä mahdolliset bonusmerkit
  renderYellowBonusBadges();
  updateYellowBonusBadges();
}



function setupBlueTrack(){
  state.sheet.blue.marked = {};
  const wrap = qs("#blue-track");
  wrap.innerHTML = "";
  for (let n=2; n<=12; n++){
    const b = document.createElement("div");
    b.className = "box";
    b.dataset.val = n;
    b.textContent = n;
    wrap.appendChild(b);
  }
  renderBlueBonusBadges();
  updateBlueBonusBadges();

}

function setupGreenRow(){
  const th = [];
  const base = [1,2,3,4,5,6,2,3,4,5];
  for (let i=0;i<10;i++) th.push(base[i]);

  // data
  state.sheet.green.thresholds = th;
  state.sheet.green.idx = 0;

  // DOM
  const wrap = qs("#green-row");
  wrap.innerHTML = "";
  th.forEach((t,i)=>{
    const s = document.createElement("div");
    s.className = "slot";
    s.dataset.idx = i;
    // yhtenäinen rakenne muiden värien kanssa:
    s.innerHTML = `<span class="val">${t}</span>`;
    wrap.appendChild(s);
  });

  // Badgejen piirto/päivitys – turvallisesti
  const safe = (fn) => { try { fn && fn(); } catch(e){ console.warn(e); } };

  // pieni viive varmistaa, että wrapperit + GREEN_MILESTONES on jo määritelty
  setTimeout(() => {
    safe(typeof renderGreenBonusBadges === "function" && renderGreenBonusBadges);
    safe(typeof updateGreenBonusBadges === "function" && updateGreenBonusBadges);
  }, 0);
}

function setupOrangeRow(){
  // data
  state.sheet.orange.idx = 0;
  state.sheet.orange.values = Array(10).fill(null);
  state.sheet.orange.x2 = [2,6];

  // DOM
  const wrap = qs("#orange-row");
  wrap.innerHTML = "";
  for (let i=0;i<10;i++){
    const s = document.createElement("div");
    s.className = "slot" + (state.sheet.orange.x2.includes(i) ? " x2" : "");
    s.dataset.idx = i;
    s.innerHTML = `<span class="val">—</span>`;
    wrap.appendChild(s);
  }

  // Badget turvallisesti
  const safe = (fn) => { try { fn && fn(); } catch(e){ console.warn(e); } };
  setTimeout(() => {
    safe(typeof renderOrangeBonusBadges === "function" && renderOrangeBonusBadges);
    safe(typeof updateOrangeBonusBadges === "function" && updateOrangeBonusBadges);
  }, 0);
}

function setupPurpleRow(){
  // data
  state.sheet.purple.idx = 0;
  state.sheet.purple.values = Array(10).fill(null);

  // DOM
  const wrap = qs("#purple-row");
  wrap.innerHTML = "";
  for (let i=0;i<10;i++){
    const s = document.createElement("div");
    s.className = "slot";
    s.dataset.idx = i;
    s.innerHTML = `<span class="val">—</span>`;
    wrap.appendChild(s);
  }

  // Badget turvallisesti
  const safe = (fn) => { try { fn && fn(); } catch(e){ console.warn(e); } };
  setTimeout(() => {
    safe(typeof renderPurpleBonusBadges === "function" && renderPurpleBonusBadges);
    safe(typeof updatePurpleBonusBadges === "function" && updatePurpleBonusBadges);
  }, 0);
}

// ---------- DICE FLOW ----------
function rollRemaining(){
  if (state.pick >= PICKS_PER_ROUND) { setStatus("Valinnat täynnä tältä kierrokselta."); return; }
  if (state.hasRolledThisPick){
    setStatus("Et voi heittää uudestaan valitsematta noppaa. Käytä Uusinta (–1) jos haluat lisäheiton.");
    return;
  }
  const alive = state.dice.filter(d=>d.alive && !d.inSilver);
  if (alive.length === 0) { setStatus("Ei heitettäviä noppia."); return; }

  alive.forEach(d => d.value = 1 + Math.floor(Math.random()*6));
  state.lastRollStamp = Date.now();
  state.chosenDie = null;
  state.plusOneArmed = false;
  state.hasRolledThisPick = true;   // ← ilmainen heitto käytetty
  clearYellowHighlights();
  renderDice();
  updateHUD();
  setStatus("Valitse yksi noppa ja tee merkintä.");
}


function useReroll(){
  // Uusinta (↻ kaikki): kuluttaa 1 uusinnan, palauttaa hopealautasen nopat käteen
// ja heittää uudestaan KAIKKI elossa olevat nopat (alive), riippumatta inSilver-tilasta.
// Pelilapulle tehdyt merkinnät säilyvät (niitä ei tässä kosketa).

  if (state.rerolls <= 0) { setStatus("Uusinnat loppu."); return; }

  // Onko mitään heitettävää? Ainakin yksi elossa oleva noppa tarvitaan.
  const anyAlive = state.dice.some(d => d.alive);
  if (!anyAlive) { setStatus("Ei heitettäviä noppia."); return; }

  state.rerolls--;

  // 1) Palauta hopealautasen nopat käteen (inSilver -> false)
  state.dice.forEach(d => {
    if (d.alive && d.inSilver) d.inSilver = false;
  });

  // 2) Heitä kaikki elossa olevat (myös ne, jotka olivat äsken hopealautasella)
  state.dice.forEach(d => {
    if (d.alive) d.value = 1 + Math.floor(Math.random()*6);
  });

  // Sama resetti valintaa varten kuin muissakin heitoissa
  state.chosenDie = null;
  state.plusOneArmed = false;
  // Pysytään saman valinnan sisällä → hasRolledThisPick ei muutu (yleensä TRUE)
  clearYellowHighlights();
  renderAll();

  setStatus("Uusinta (↻) tehty. Kaikki nopat heitetty uudestaan. Valitse noppa.");
}


function clickDie(color){
  // 0) PERUUTUS: jos valinta on hopealautaselta ja sama väri klikataan uudelleen
  if (state.chosenDie?.die?.inSilver && state.chosenDie.area === color){
    // Palauta +1, jos kulutit sen heti valinnassa. Jos teillä kulutus tapahtuu vasta finalize:ssa, poista seuraavat 2 riviä.
    state.plusOnes++;
    state.plusOneArmed = false;
    updateHUD?.();

    // Tyhjennä valinta ja UI
    setStatus("+1 peruttu.");
    state.chosenDie = null;
    clearDieSelection?.();
    if (typeof clearYellowHighlights === "function") clearYellowHighlights();
    return;
  }

  // 1) Jos meillä on jo valittuna hopealautasen noppa ja väri vastaa painiketta,
  //    käytä TÄTÄ noppaa (älä etsi laudalta uutta)
  let die = null;
  if (state.chosenDie?.die?.inSilver && state.chosenDie.die.color === color){
    die = state.chosenDie.die;
  } else {
    // Muuten etsi laudalta (ei hopealautaselta)
    die = state.dice.find(d => d.color===color && d.alive && !d.inSilver);
  }

  if (!die || die.value == null){
    setStatus("Heitä ensin.");
    return;
  }

  // 2) Valkoinen: kysy kohdeväri dialogilla ja reititä sen jälkeen
  if (color === "white"){
    state.chosenDie = { die, area: null }; // ei kulutusta tässä
    const dlg = qs("#white-choose");
    if (!dlg){ console.warn("#white-choose puuttuu"); return; }

    // nollaa vanhat handlerit
    dlg.querySelectorAll("button[data-area]").forEach(btn=>{
      btn.replaceWith(btn.cloneNode(true));
    });

    dlg.showModal();
    dlg.querySelectorAll("button[data-area]").forEach(btn=>{
      btn.addEventListener("click", () => {
        dlg.close();
        const area = btn.dataset.area;
        routeDieToArea(die, area);
      }, { once:true });
    });
    return;
  }

  // 3) Muut värit: suoraan omaan alueeseen
  routeDieToArea(die, color);
}



function routeDieToArea(die, area){
  // Visuaalinen kuittaus valinnasta (laudan noppalistassa)
  clearDieSelection?.();
  const el = [...document.querySelectorAll('#dice-available .die')]
    .find(d => d.classList.contains(die.color));
  if (el) el.classList.add("selected");

  // Aseta chosenDie ja ohjeistus + mahdollinen korostus
  state.chosenDie = { die, area };

  switch(area){
    case "yellow":
      setStatus(`Valittu ${prettyDie?.(die) ?? die.color} → Keltainen: napauta ruutua arvolla ${die.value}.`);
      if (typeof highlightYellowOptions === "function") highlightYellowOptions(die.value);
      break;
    case "blue":
      setStatus(`Valittu ${prettyDie?.(die) ?? die.color} → Sininen: napauta summaa (Sininen+Valkoinen).`);
      break;
    case "green":
      setStatus(`Valittu ${prettyDie?.(die) ?? die.color} → Vihreä: napauta seuraavaa hyväksyttävää solua.`);
      break;
    case "orange":
      setStatus(`Valittu ${prettyDie?.(die) ?? die.color} → Oranssi: napauta seuraavaa tyhjää solua.`);
      break;
    case "purple":
      setStatus(`Valittu ${prettyDie?.(die) ?? die.color} → Violetti: napauta seuraavaa sallittua solua.`);
      break;
  }

  // Jos haluat, voit tässä kohtaa korostaa aktiivisen alueen yleisesti:
  if (typeof highlightArea === "function") highlightArea(area);
}



function diePickedFinalize(chosenDieObj){
  const chosen = chosenDieObj.die;
  const chosenValue = chosen.value;

  // Siirrä kaikki pienemmät hopealautaselle
  state.dice.forEach(d=>{
    if (d.alive && !d.inSilver && d !== chosen && d.value!=null && d.value < chosenValue){
      d.inSilver = true;
      if (!state.silver.includes(d)) state.silver.push(d);
    }
	state.hasRolledThisPick = false; // seuraavaa valintaa varten saa taas yhden ilmaisen heiton

  });

  // Valittu noppa kulutetaan tältä kierrokselta
  chosen.alive = false;

  // Päivitykset
  state.pick++;
  state.chosenDie = null;
  state.plusOneArmed = false;
  clearDieSelection();
  clearYellowHighlights();
  renderDice();
  updateHUD();

  if (state.pick >= PICKS_PER_ROUND){
    setStatus("Valinnat tehty tältä kierrokselta. Voit käyttää +1 tai siirtyä seuraavaan kierrokseen.");
  } else {
    setStatus(`Valinta ${state.pick}/${PICKS_PER_ROUND} tehty. Heitä jäljellä olevat.`);
  }
}

function endPicks(){
  if (state.pick < PICKS_PER_ROUND && state.dice.some(d=>d.alive && !d.inSilver)){
    if (!confirm("Et ole tehnyt kaikkia 3 valintaa. Lopetetaanko silti?")) return;
  }
  if (state.round >= ROUNDS_TOTAL){
    setStatus("Peli päättyi. Laske pisteet.");
  } else {
    nextRound();
  }
}

// ---------- +1 FROM SILVER (tila + suora klikkaus) ----------
function usePlusOneToggle(){
  if ((state.plusOnes||0) <= 0){ setStatus("+1 loppu."); return; }

  // onko hopealautasella mitään?
  const tray = document.querySelector('#dice-silver, #silver-tray, #silver');
  const hasSilverDice = !!(tray && tray.querySelector('.die'));
  if (!hasSilverDice){ setStatus("Hopealautanen on tyhjä."); return; }

  state.plusOneArmed = !state.plusOneArmed;

  if (state.plusOneArmed){
    // aloita valintatila, ei kulutusta
    state.ui.silverArmedDieId = null;
    document.querySelectorAll('#dice-silver .die').forEach(el=> el.classList.remove('armed'));
    setStatus("+1 käytössä: klikkaa hopealautaselta noppaa.");
  } else {
    // peru: poista kehys ja nollaa
    document.querySelectorAll('#dice-silver .die').forEach(el=> el.classList.remove('armed'));
    state.ui.silverArmedDieId = null;
    setStatus("+1 peruttu.");
  }
  renderDice?.();
}



// ---------- MARK LOGIC ----------
function tryMarkYellow(idx){
  if (!state.chosenDie || state.chosenDie.area!=="yellow"){
    setStatus("Valitse ensin keltainen (tai valkoinen→keltainen).");
    return;
  }
  const die = state.chosenDie.die;
  const needs = state.sheet.yellow.grid[idx];
  const already = state.sheet.yellow.marked.has(idx);
  const dieVal = Number(die?.value);
  const needVal = Number(needs);

  if (already){ setStatus("Tämä ruutu on jo merkitty."); return; }
  if (!(die && (die.color==="yellow" || die.color==="white"))){
    setStatus("Keltaiseen käy vain keltainen tai valkoinen noppa."); return;
  }
  if (die.value == null){ setStatus("Heitä nopat ensin."); return; }
  if (dieVal !== needVal){
    setStatus(`Tarvitaan ${needVal}, valitsit ${dieVal}. Klikkaa ruutua, jossa on ${dieVal}.`);
    return;
  }

  state.sheet.yellow.marked.add(idx);
  const cell = qs(`#yellow-grid .cell[data-idx="${idx}"]`);
  if (cell) cell.classList.add("marked");

  clearYellowHighlights();
  diePickedFinalize(state.chosenDie);
}

function tryMarkBlue(val){
  if (!state.chosenDie || state.chosenDie.area!=="blue"){
    setStatus("Valitse ensin sininen (tai valkoinen→sininen).");
    return;
  }
  const blue = state.dice.find(d=>d.color==="blue");
  const white = state.dice.find(d=>d.color==="white");
  if (!blue?.value || !white?.value){ setStatus("Heitä ensin (tarvitaan sekä sinisen että valkoisen arvot)."); return; }

  const sum = blue.value + white.value;
  if (val !== sum){ setStatus(`Valitse summa ${sum}.`); return; }
  if (state.sheet.blue.marked[val]){ setStatus("Tämä summa on jo merkitty."); return; }

  state.sheet.blue.marked[val] = true;
  qs(`#blue-track .box[data-val="${val}"]`)?.classList.add("marked");
  diePickedFinalize(state.chosenDie);
}

function tryMarkGreen(idx){
  if (!state.chosenDie || state.chosenDie.area!=="green"){
    setStatus("Valitse ensin vihreä (tai valkoinen→vihreä).");
    return;
  }
  const next = state.sheet.green.idx;
  if (idx !== next){ setStatus("Merkitse seuraava vapaa vasemmalta."); return; }
  const need = state.sheet.green.thresholds[idx];
  const die = state.chosenDie.die;
  const val = die.value;
  if (!(die.color==="green" || die.color==="white")){ setStatus("Käytä vihreää/valkoista."); return; }
  if (val < need){ setStatus(`Tarvitaan vähintään ${need}.`); return; }

  state.sheet.green.idx++;
  const el = qs(`#green-row .slot[data-idx="${idx}"]`);
  el?.classList.add("marked");
  el?.insertAdjacentHTML("beforeend", `<span class="tiny">✓</span>`);
  diePickedFinalize(state.chosenDie);
}

function tryMarkOrange(idx){
  if (!state.chosenDie || state.chosenDie.area!=="orange"){
    setStatus("Valitse ensin oranssi (tai valkoinen→oranssi).");
    return;
  }
  if (idx !== state.sheet.orange.idx){ setStatus("Merkitse seuraava vapaa vasemmalta."); return; }
  const die = state.chosenDie.die;
  if (!(die.color==="orange" || die.color==="white")){ setStatus("Käytä oranssia/valkoista."); return; }

  state.sheet.orange.values[idx] = die.value;
  state.sheet.orange.idx++;
  const el = qs(`#orange-row .slot[data-idx="${idx}"] .val`);
  if (el) el.textContent = die.value;
  qs(`#orange-row .slot[data-idx="${idx}"]`)?.classList.add("marked");
  diePickedFinalize(state.chosenDie);
}

function tryMarkPurple(idx){
  if (!state.chosenDie || state.chosenDie.area!=="purple"){
    setStatus("Valitse ensin violetti (tai valkoinen→violetti).");
    return;
  }
  if (idx !== state.sheet.purple.idx){ setStatus("Merkitse seuraava vapaa vasemmalta."); return; }
  const die = state.chosenDie.die;
  if (!(die.color==="purple" || die.color==="white")){ setStatus("Käytä violettia/valkoista."); return; }

  const prev = lastFilled(state.sheet.purple.values);
  const val = die.value;
  if (prev != null){
    if (prev === 6){
      // reset: mikä tahansa ok
    } else if (val <= prev){
      setStatus(`Arvon tulee olla suurempi kuin ${prev} (tai 6 reset).`);
      return;
    }
  }

  state.sheet.purple.values[idx] = val;
  state.sheet.purple.idx++;
  const el = qs(`#purple-row .slot[data-idx="${idx}"] .val`);
  if (el) el.textContent = val;
  qs(`#purple-row .slot[data-idx="${idx}"]`)?.classList.add("marked");
  diePickedFinalize(state.chosenDie);
}

function lastFilled(arr){
  for (let i=arr.length-1;i>=0;i--){
    if (arr[i]!=null) return arr[i];
  }
  return null;
}

// ---------- HIGHLIGHTS & SELECTION ----------
function clearDieSelection(){
  qsa('.die.selected').forEach(el => el.classList.remove('selected'));
}
function clearYellowHighlights(){
  qsa('#yellow-grid .cell.highlight').forEach(el => el.classList.remove('highlight'));
}
function highlightYellowOptions(dieValue){
  clearYellowHighlights();
  qsa('#yellow-grid .cell').forEach(el=>{
    const idx = parseInt(el.dataset.idx,10);
    const need = state.sheet.yellow.grid[idx];
    const free = !state.sheet.yellow.marked.has(idx);
    if (free && Number(need) === Number(dieValue)){
      el.classList.add('highlight');
    }
  });
}

// ---------- SCORING ----------
function calcScore(){
// --- YELLOW ---
// pisteet = ruksittujen solujen numerot, mutta ei esitäytettyä diagonaalia
const Y = state.sheet.yellow;
const grid = Y.grid || [];                           // 16 numeroa
const marked = Y.marked || new Set();
const prefill = Y.prefilledDiag || [];               // [0,5,10,15] tms.

let yScore = 0;
marked.forEach(idx => {
  if (!prefill.includes(idx)) {
    const v = grid[idx] ?? 0;
    yScore += Number.isFinite(v) ? v : 0;
  }
});

// pystysarakkeista vain extrapisteet (kertyy awardCol:ssa)
const yExtra = state._yellowExtraPoints || 0;

  // --- BLUE ---
  const B = state.sheet.blue;
  const blueCount = Object.keys(B.marked).length;
  const bScore = Math.round(blueCount * (blueCount+1) / 2);

  // --- GREEN ---
  const gCount = state.sheet.green.idx;
  const gScore = Math.round(gCount * (gCount+1) / 2);

  // --- ORANGE ---
  const O = state.sheet.orange;
  let oScore = 0;
  for (let i=0;i<10;i++){
    const v = O.values[i];
    if (v!=null) oScore += O.x2.includes(i) ? v*2 : v;
  }

  // --- PURPLE ---
  const P = state.sheet.purple;
  let pScore = 0;
  for (let v of P.values) if (v!=null) pScore += v;

  // --- FOX (🦊) ---
  const foxCount = state._foxCount || 0;
  const minColor = Math.min(yScore, bScore, gScore, oScore, pScore);
  const foxScore = foxCount * minColor;

  // --- Kokonaispisteet ---
  const total = yScore + yExtra + bScore + gScore + oScore + pScore + foxScore;

  return {
    yScore,        // keltainen rivipisteet
    yExtra,        // keltaisen extrapisteet sarakkeista
    bScore,        // sininen
    gScore,        // vihreä
    oScore,        // oranssi
    pScore,        // violetti
    foxCount,      // kettujen määrä
    foxScore,      // kettubonus
    total
  };
}


// ---------- RENDER ----------
function renderAll(){

  renderDice();
  updateHUD();
  renderSheetVisuals();
}

function updateHUD(){
  qs("#round").textContent = `Kierros: ${state.round} / ${ROUNDS_TOTAL}`;
  qs("#pick").textContent = `Valinnat: ${state.pick} / ${PICKS_PER_ROUND}`;
  qs("#rerolls").textContent = `Uusinnat ↻: ${state.rerolls}`;
  qs("#plusones").textContent = `+1: ${state.plusOnes}`;

  const btnReroll = qs("#btn-reroll");
  if (btnReroll){
    const anyAlive = state.dice.some(d => d.alive);
    const anyRolled = state.dice.some(d => d.value != null); // onko nopilla jo arvoja
    btnReroll.disabled = (
      state.rerolls <= 0 ||   // ei uusintoja jäljellä
      !anyAlive ||            // ei elossa olevia noppia
      !anyRolled              // ei ole vielä kertaakaan heitetty
    );
  }
}

// --- UI state ---
if (!state.ui) state.ui = {};
if (state.ui.silverArmedDieId == null) state.ui.silverArmedDieId = null;



function renderDice(){
  const cont = qs("#dice-available");
  const silv = qs("#dice-silver");
  cont.innerHTML = "";
  silv.innerHTML = "";

  state.silver = []; // rakennetaan uudestaan varmuuden vuoksi

  state.dice.forEach(d=>{
    const div = document.createElement("div");
    div.className = `die ${d.color}` + (d.inSilver ? " silver" : "");
    div.textContent = d.value ?? "—";
    div.setAttribute("data-color", d.color);

    if (d.inSilver) {
      if (state.plusOneArmed) div.classList.add("clickable");
	  if (!d.alive) div.classList.add("disabled");             // ← UUSI: harmaa ulkoasu
      silv.appendChild(div);
      if (!state.silver.includes(d)) state.silver.push(d);
    } else if (d.alive) {
      cont.appendChild(div);
    } else {
      // käytetty noppa ei näy enää available-jonossa; jos haluat näyttää, voit lisätä erillisen listan
      silv.appendChild(div);
    }
	  if (state.ui?.silverArmedDieId != null){
    const el = document.querySelector(`#dice-silver .die[data-id="${state.ui.silverArmedDieId}"]`);
    el?.classList.add('armed');
  }
  });

  // napit
qs("#btn-roll").disabled =
  state.pick >= PICKS_PER_ROUND ||
  state.hasRolledThisPick ||                                    // ← uusi ehto
  state.dice.every(d=>!d.alive || d.inSilver);

  qs("#btn-reroll").disabled = qs("#btn-roll").disabled || state.rerolls<=0;
  qs("#btn-plusone").disabled = state.silver.length===0 || state.plusOnes<=0;
  
}

function renderSheetVisuals(){
  for (let n=2;n<=12;n++){
    const el = qs(`#blue-track .box[data-val="${n}"]`);
    if (!el) continue;
    el.classList.toggle("marked", !!state.sheet.blue.marked[n]);
  }
}

// ---------- UI BIND ----------
function bindUI(){
   qs("#btn-new").addEventListener("click", ()=>{
    if (state.round >= ROUNDS_TOTAL) {
      // Kierrokset jo täynnä → aloita suoraan uusi peli
      newGame();
    } else {
      // Muulloin kysytään varmistus
      if (confirm("Aloitetaanko uusi peli? Nykyinen menetetään.")) {
        newGame();
      }
    }
  });
  qs("#btn-help").addEventListener("click", ()=> qs("#help").showModal());
  qs("#btn-roll").addEventListener("click", rollRemaining);
  qs("#btn-reroll").addEventListener("click", useReroll);
  qs("#btn-plusone").addEventListener("click", usePlusOneToggle);
  qs("#btn-endpick").addEventListener("click", endPicks);

  qs("#btn-score").addEventListener("click", ()=>{
    const s = calcScore();
    qs("#score-out").textContent =
      `Kelt: ${s.yScore}+${s.yExtra}   Sin: ${s.bScore}  Vih: ${s.gScore}  Ora: ${s.oScore}  Vio: ${s.pScore} 🦊: ${s.foxScore} 👉 Yhteensä: ${s.total}`;
  });

  // Delegoitu klikkaus: NOPAT (available)
  qs("#dice-available").addEventListener("click", (ev) => {
    const dieEl = ev.target.closest(".die");
    if (!dieEl) return;
    const color = dieEl.getAttribute("data-color");
    if (!color) return;

    const die = state.dice.find(d => d.color === color);
    if (!die || die.value == null) { setStatus("Heitä ensin."); return; }
    if (!die.alive || die.inSilver) { setStatus("Tämä noppa ei ole valittavissa."); return; }

    clearDieSelection();
    dieEl.classList.add("selected");
    clickDie(color);
  });

 // Delegoitu klikkaus: HOPEALAUTASEN nopat (+1-tila)
qs("#dice-silver").addEventListener("click", (ev) => {
  const dieEl = ev.target.closest(".die");
  if (!dieEl) return;

  const color = dieEl.getAttribute("data-color") ||
    dieEl.className.split(" ").find(c => DICE_COLORS.includes(c));
  const die = state.dice.find(d => d.color === color && d.inSilver);
  if (!die || die.value == null){ setStatus("Tässä nopassa ei ole arvoa."); return; }
  if (!die.alive){ setStatus("Tämä hopealautasen noppa on jo käytetty."); return; }  // ← UUSI
  // --- PERUUTUS: sama hopeanoppa uudelleen -> +1 takaisin, valinta pois ---
  if (dieEl.classList.contains("armed")) {
    dieEl.classList.remove("armed");

    // jos äsken kulutettiin +1, palautetaan se
    state.plusOnes++;
    state.plusOneArmed = false;
    state.chosenDie = null;

    // jos valkoinen valintadialogi on auki, sulje se
    try { qs("#white-choose")?.close(); } catch(e){}

    updateHUD?.();
    setStatus("+1 peruttu.");
    return;
  }

  // --- uusi valinta vaatii +1-tilan ---
  if (!state.plusOneArmed){
    setStatus("Käytä +1-nappia, jos haluat käyttää hopealautasen noppaa.");
    return;
  }

  // kuluta +1 nyt ja merkitse tämä noppadivi 'armed'iksi (toista klikkausta varten)
  state.plusOnes--;
  state.plusOneArmed = false;
  updateHUD?.();

  // poista muilta mahdollinen armed, aseista tämä
  document.querySelectorAll('#dice-silver .die.armed').forEach(el=> el.classList.remove('armed'));
  dieEl.classList.add("armed");

  // aseta valinta ja ohje
  if (die.color === "white"){
    state.chosenDie = { die, area: null }; // kohdeväri valitaan dialogissa

    const dlg = qs("#white-choose");
    dlg.showModal();

    // nollaa vanhat handlerit
    dlg.querySelectorAll("button[data-area]").forEach(btn=>{
      btn.replaceWith(btn.cloneNode(true));
    });

    dlg.querySelectorAll("button[data-area]").forEach(btn=>{
      btn.addEventListener("click", () => {
        dlg.close();
        const area = btn.dataset.area;
        state.chosenDie = { die, area };
        // ÄLÄ kutsu renderDice() tässä, ettei 'armed' katoa
        routeDieToArea(die, area);
      }, { once:true });
    });
  } else {
    state.chosenDie = { die, area: die.color };
    // ÄLÄ kutsu renderDice() tässä, ettei 'armed' katoa
    routeDieToArea(die, die.color);
  }
});

  // Delegoitu klikkaus: KOKO PISTETAULUKKO
  const sheetEl = qs(".sheet");
  sheetEl.addEventListener("click", (ev) => {
    const yellowCell = ev.target.closest("#yellow-grid .cell");
    if (yellowCell) {
      const idx = parseInt(yellowCell.dataset.idx, 10);
      tryMarkYellow(idx);
      return;
    }

    const blueBox = ev.target.closest("#blue-track .box");
    if (blueBox) {
      const val = parseInt(blueBox.dataset.val, 10);
      tryMarkBlue(val);
      return;
    }

    const greenSlot = ev.target.closest("#green-row .slot");
    if (greenSlot) {
      const idx = parseInt(greenSlot.dataset.idx, 10);
      tryMarkGreen(idx);
      return;
    }

    const orangeSlot = ev.target.closest("#orange-row .slot");
    if (orangeSlot) {
      const idx = parseInt(orangeSlot.dataset.idx, 10);
      tryMarkOrange(idx);
      return;
    }

    const purpleSlot = ev.target.closest("#purple-row .slot");
    if (purpleSlot) {
      const idx = parseInt(purpleSlot.dataset.idx, 10);
      tryMarkPurple(idx);
      return;
    }
  });
}

// ---------- UTIL ----------
function setStatus(msg){ qs("#status").textContent = msg; }

function prettyDie(die){
  const name = COLOR_LABELS[die.color] || die.color;
  const v = (die.value==null ? "—" : die.value);
  return `${name} ${v}`;
}

// Bonus: merkitse oranssiin suoraan tietty arvo (ilman diePickedFinalizea)
function bonusMarkOrangeValue(value){
  if (!state || !state.sheet || !state.sheet.orange) {
    setStatus && setStatus("Oranssia ei löydy taulusta.");
    return false;
  }
  const idx = state.sheet.orange.idx;
  const row = state.sheet.orange.values;
  if (idx == null || !Array.isArray(row)) {
    setStatus && setStatus("Oranssi ei ole alustettu.");
    return false;
  }
  if (idx >= row.length){
    setStatus && setStatus("Oranssi on jo täynnä.");
    return false;
  }

  // Aseta arvo suoraan tauluun ja UI:hin
  row[idx] = value;
  state.sheet.orange.idx++;

  const slotSel = `#orange-row .slot[data-idx="${idx}"]`;
  const elVal = qs(`${slotSel} .val`);
  if (elVal) elVal.textContent = value;
  qs(slotSel)?.classList.add("marked");

  // Päivitä HUD/tilaviesti tarvittaessa
  if (typeof updateHUD === "function") updateHUD();
  setStatus && setStatus(`Bonus: oranssi ${value}`);

  // Ei kutsuta diePickedFinalizea → ei muuteta pick- tai tray-logiikkaa
  return true;
}

// Bonus: merkitse violettiin suoraan tietty arvo (ilman diePickedFinalizea)
function bonusMarkPurpleValue(value){
  if (!state || !state.sheet || !state.sheet.purple) {
    setStatus && setStatus("Violettia ei löydy taulusta.");
    return false;
  }
  const idx = state.sheet.purple.idx;
  const row = state.sheet.purple.values;
  if (idx == null || !Array.isArray(row)) {
    setStatus && setStatus("Violetti ei ole alustettu.");
    return false;
  }
  if (idx >= row.length){
    setStatus && setStatus("Violetti on jo täynnä.");
    return false;
  }

  // Tarkista violettiin liittyvä sääntö (kasvava tai reset 6)
  const prev = lastFilled(row);
  if (prev != null){
    if (prev === 6){
      // reset: mikä tahansa ok
    } else if (value <= prev && value !== 6){
      setStatus && setStatus(`Arvon tulee olla suurempi kuin ${prev} (tai 6 reset).`);
      return false;
    }
  }

  // Aseta arvo suoraan tauluun ja UI:hin
  row[idx] = value;
  state.sheet.purple.idx++;

  const slotSel = `#purple-row .slot[data-idx="${idx}"]`;
  const elVal = qs(`${slotSel} .val`);
  if (elVal) elVal.textContent = value;
  qs(slotSel)?.classList.add("marked");

  if (typeof updateHUD === "function") updateHUD();
  setStatus && setStatus(`Bonus: violetti ${value}`);

  return true;
}
// ==============================
// BONUS: Vihreä – merkitse seuraava rasti automaattisesti
// ==============================
// Ei käytä diePickedFinalizea eikä state.chosenDie:ta.
// Tekee kolme yritystä järjestyksessä:
// 1) Jos projektissa on oma apuri (bonusMarkGreenNext), käytä sitä.
// 2) Jos laudassa on tuttu rakenne (state.sheet.green.idx + values[]),
//    merkitään seuraava slotti täytetyksi ja päivitetään UI.
// 3) Muuten näytetään vain statusviesti (ei rikota peliä).
function bonusMarkGreenNext(){
  // 1) Projekti tarjoaa oman apurin?
  if (typeof window.bonusMarkGreenNextImpl === "function"){
    window.bonusMarkGreenNextImpl();
    setStatus && setStatus("Bonus: vihreä rasti");
    if (typeof updateHUD === "function") updateHUD();
    return true;
  }

  // 2) Yritä käyttää tuttua rakennetta
  if (state?.sheet?.green && Array.isArray(state.sheet.green.values)){
    const idx = state.sheet.green.idx ?? 0;
    const row = state.sheet.green.values;
    if (idx >= row.length){
      setStatus && setStatus("Vihreä on jo täynnä.");
      return false;
    }

    // Merkitse rasti; jos teillä vihreässä on numeerinen arvo, vaihda tähän sopiva merkintä
    row[idx] = true;                         // merkkaa täytetyksi
    state.sheet.green.idx = idx + 1;

    // Päivitä UI (säädä selektorit, jos teillä on eri id/luokat)
    const slotSel = `#green-row .slot[data-idx="${idx}"]`;
    const elVal = qs(`${slotSel} .val`);
    if (elVal) elVal.textContent = "✓";
    qs(slotSel)?.classList.add("marked");

    setStatus && setStatus("Bonus: vihreä rasti");
    if (typeof updateHUD === "function") updateHUD();
    return true;
  }

  // 3) Ei tunnistettavaa rakennetta
  setStatus && setStatus("Bonus: vihreä rasti (tarvitsee projektikohtaisen apurin merkitäkseen automaattisesti)");
  return false;
}


// ==============================
// BONUS: Keltainen – satunnainen laillinen rasti automaattisesti
// ==============================
// Ei käytä diePickedFinalizea eikä state.chosenDie:ta.
// Tekee kolme yritystä järjestyksessä:
// 1) Jos on suora apuri (bonusMarkYellowRandom), käytä sitä.
// 2) Jos löytyy API laillisille kohteille (getLegalYellowTargets + tryMarkYellow),
//    arvo yksi kohde ja merkitse se.
// 3) Fallback: jos tunnistamme gridin rakenteen (state.sheet.yellow + UI-slotit),
//    valitaan satunnainen tyhjä slotti ja merkitään se “X” (HUOM: säädä teidän sääntöihin).
function bonusMarkYellowRandom(){
  // 1) Projekti-spesifi apuri?
  if (typeof window.bonusMarkYellowRandomImpl === "function"){
    window.bonusMarkYellowRandomImpl();
    setStatus && setStatus("Bonus: satunnainen rasti keltaiseen");
    if (typeof updateHUD === "function") updateHUD();
    return true;
  }

  // 2) Lailliset kohteet → suora merkintä?
  if (typeof window.getLegalYellowTargets === "function" && typeof window.tryMarkYellow === "function"){
    const targets = window.getLegalYellowTargets();
    if (Array.isArray(targets) && targets.length){
      const pick = targets[Math.floor(Math.random()*targets.length)];
      window.tryMarkYellow(pick);
      setStatus && setStatus("Bonus: satunnainen rasti keltaiseen");
      if (typeof updateHUD === "function") updateHUD();
      return true;
    }
  }

  // 3) Fallback: etsi merkitsemättömät .cell-solut
  const wrap = document.getElementById("yellow-grid");
  if (wrap){
    const cells = Array.from(wrap.querySelectorAll('.cell:not(.marked)'));
    if (cells.length){
      const cell = cells[Math.floor(Math.random()*cells.length)];
      const idx = +cell.dataset.idx;

      // UI
      cell.classList.add("marked");
      cell.setAttribute("aria-checked","true");

      // Data
      if (state?.sheet?.yellow?.marked instanceof Set){
        state.sheet.yellow.marked.add(idx);
      }

      setStatus && setStatus("Bonus: satunnainen rasti keltaiseen");
      if (typeof updateHUD === "function") updateHUD();
      return true;
    }
  }

  setStatus && setStatus("Bonus: keltaisessa ei ollut vapaata ruutua.");
  return false;
}


/* ===== Passive solo pick wrapper (non-invasive) ===== */
(function(){
  // Varmistus selaimessa
  if (typeof window === "undefined") { window = {}; }

  // --- Pienet apufunktiot passiivivuorolle ---
  function skipPassivePick() {
    // Passiivivuoro ohitetaan ja siirrytään seuraavaan kierrokseen
    state._passivePending = false;
    const skipBtn = document.getElementById("btn-passive-skip");
    if (skipBtn) skipBtn.style.display = "none";

    if (state.round >= ROUNDS_TOTAL){
      setStatus("Peli päättyi. Laske pisteet.");
    } else {
      nextRound();
    }
  }

  // Kevyt arvio: löytyykö hopealautaselta todennäköinen laillinen siirto?
  // Jos projektilta löytyy tarkkoja canMark*-funktioita, käytetään niitä.
  function hasLikelyLegalPassiveMove() {
    if (!Array.isArray(state.silver) || state.silver.length === 0) return false;

    for (const die of state.silver) {
      const v = die.value;

      // Valkoinen voidaan yleensä ohjata mihin vain → pidetään mahdollisena
      if (die.color === "white") return true;

      // Jos tarkemmat tarkistimet ovat käytössä, käytä niitä
      if (typeof canMarkYellow === "function" && die.color === "yellow" && canMarkYellow(v)) return true;
      if (typeof canMarkGreen  === "function" && die.color === "green"  && canMarkGreen(v))  return true;
      if (typeof canMarkOrange === "function" && die.color === "orange" && canMarkOrange(v)) return true;
      if (typeof canMarkPurple === "function" && die.color === "purple" && canMarkPurple(v)) return true;
      if (typeof canMarkBlue   === "function" && die.color === "blue"   && canMarkBlue(v))   return true;

      // Jos tarkentavia funktioita ei ole, oletetaan varovasti mahdolliseksi
      if (typeof canMarkYellow !== "function" &&
          typeof canMarkGreen  !== "function" &&
          typeof canMarkOrange !== "function" &&
          typeof canMarkPurple !== "function" &&
          typeof canMarkBlue   !== "function") {
        return true;
      }
    }
    return false;
  }

  // --- Wrapperin sisäiset tilaliput (ei kosketa alkuperäisiä nimiä) ---
  if (!('_passivePending' in state)) state._passivePending = false;
  if (!('_passiveTempPlusOneGranted' in state)) state._passiveTempPlusOneGranted = false;

  // --- Kiedo endPicks: käynnistä passiivivuoro hopealautaselta, muuten jatka normaalisti ---
  if (typeof endPicks === 'function' && !window.__endPicksPatched){
    const __endPicksOriginal = endPicks;
    window.__endPicksPatched = true;

    window.endPicks = function(){
      const hasSilver = Array.isArray(state.silver) && state.silver.length > 0;

      if (hasSilver){
        // Jos mitään pelattavaa ei näytä olevan → ohita passiivi
        if (!hasLikelyLegalPassiveMove()){
          setStatus("Passiivipelaajalle ei ole kelvollista siirtoa. Siirrytään seuraavaan kierrokseen.");
          skipPassivePick();
          return;
        }

        // Käynnistä passiivivalinta:
        // annetaan väliaikainen +1 ja aseistetaan se, jotta hopealautanen on klikattavissa
        state._passivePending = true;
        state._passiveTempPlusOneGranted = true;
        state.plusOnes += 1;       // TEMP +1
        state.plusOneArmed = true; // aseista, jotta silver on klikattavissa

        setStatus("Passiivivuoro: valitse yksi hopealautasen noppa ja merkitse mihin tahansa (tai ohita).");
        renderDice();
        updateHUD();

        // (Valinnainen) Ohitusnappi, jos HTML:ssä on <button id="btn-passive-skip">
        const skipBtn = document.getElementById("btn-passive-skip");
        if (skipBtn){
          skipBtn.style.display = "inline-block";
          skipBtn.onclick = () => {
            // Jos temp-+1 on vielä aseistettuna, perutaan se siististi
            if (state._passiveTempPlusOneGranted){
              state.plusOneArmed = false;
              state.plusOnes = Math.max(0, state.plusOnes - 1);
              state._passiveTempPlusOneGranted = false;
            }
            setStatus("Passiivivuoro ohitettu. Seuraava kierros.");
            skipPassivePick();
          };
        }

        return; // odotetaan että pelaaja valitsee hopealautasen nopan tai ohittaa
      }

      // Ei hopealautasta → palauta alkuperäiseen endPicks-logiikkaan
      return __endPicksOriginal();
    };
  }

  // --- Kiedo diePickedFinalize: passiivivalinnan jälkeen seuraavaan kierrokseen ---
  if (typeof diePickedFinalize === 'function' && !window.__finalizePatched){
    const __finalizeOriginal = diePickedFinalize;
    window.__finalizePatched = true;

    window.diePickedFinalize = function(chosenDieObj){
      __finalizeOriginal(chosenDieObj);

      try {
        if (state._passivePending){
          // Passiivivalinta suoritettu
          state._passivePending = false;

          // Temp-+1 annettiin käynnistyksessä ja kului hopealautasen klikkauksessa,
          // joten nettovaikutus +1-saldoon on 0.
          if (state._passiveTempPlusOneGranted){
            state._passiveTempPlusOneGranted = false;
          }

          // Turva: älä anna valintalaskurin nousta yli kierroskaton temp-+1 takia
          if (typeof PICKS_PER_ROUND === "number" && state.pick > PICKS_PER_ROUND){
            state.pick = PICKS_PER_ROUND;
          }

          // Piilota ohitusnappi jos on
          const skipBtn = document.getElementById("btn-passive-skip");
          if (skipBtn) skipBtn.style.display = "none";

          // Siirry seuraavaan kierrokseen
          if (state.round >= ROUNDS_TOTAL){
            setStatus("Peli päättyi. Laske pisteet.");
          } else {
            nextRound();
          }
        }
      } catch (e) {
        console.error("Passive finalize hook error:", e);
      }
    };
  }
})();
/* ===== end passive wrapper ===== */

/* ===== Blue grid bonuses wrapper (auto-apply, non-invasive, unified) ===== */
(function(){
  if (typeof window === "undefined") { window = {}; }

  // --- Sinisen "ruudukon" määrittelyt (kuten pyysit) ---
  const BLUE_ROWS = [
    [10,11,12],   // → vihreä rasti
    [6,7,8,9],    // → satunnainen keltainen rasti
    [2,3,4,5]     // → oranssi 5
  ];
  const BLUE_COLS = [
    [2,6,10],     // → +1
    [3,7,11],     // → violetti 6
    [4,8,12],     // → kettobonus (FOX)
    [5,9]         // → ↻
  ];

  // --- Seurantatilat ---
  function ensureBlueState(){
    if (!state._blueHits)       state._blueHits = new Set();
    if (!state._blueRowAwarded) state._blueRowAwarded = new Set();
    if (!state._blueColAwarded) state._blueColAwarded = new Set();
    if (state._foxCount == null) state._foxCount = 0;
  }
  ensureBlueState();

  // --- Pienet bonustoiminnot ---
  function autoAddPlusOne(){
    state.plusOnes = (state.plusOnes||0) + 1;
    if (typeof updateHUD === "function") updateHUD();
    setStatus && setStatus("Bonus: +1 lisävalinta");
  }
  function autoAddReroll(){
    state.rerolls = (state.rerolls||0) + 1;
    if (typeof updateHUD === "function") updateHUD();
    setStatus && setStatus("Bonus: Uusinta (↻)");
  }
  function autoAddFox(){
    state._foxCount++;
    setStatus && setStatus(`Bonus: 🦊 kettobonus (nyt ${state._foxCount} kpl) – pisteytetään lopussa`);
  }

  // Nämä neljä apuria oletetaan olevan lisätty sovellukseen:
  // bonusMarkGreenNext(), bonusMarkYellowRandom(), bonusMarkOrangeValue(value), bonusMarkPurpleValue(value)
  // Jos jokin puuttuu, annetaan selkeä statusviesti mutta ei rikota peliä.
  function safeCall(fnName, ...args){
    const fn = (typeof window[fnName] === "function") ? window[fnName] : (typeof globalThis[fnName] === "function" ? globalThis[fnName] : null);
    if (fn) return fn(...args);
    setStatus && setStatus(`Bonus: '${fnName}' puuttuu – lisää apurifunktio.`);
    return false;
  }

  // --- Täyttymien tarkistus ja bonusten jako ---
  function checkBlueCompletions(){
    ensureBlueState();

    // Rivit
    BLUE_ROWS.forEach((row, idx) => {
      const done = row.every(v => state._blueHits.has(v));
      if (done && !state._blueRowAwarded.has(idx)){
        state._blueRowAwarded.add(idx);
        if (idx === 0) safeCall("bonusMarkGreenNext");
        if (idx === 1) safeCall("bonusMarkYellowRandom");
        if (idx === 2) safeCall("bonusMarkOrangeValue", 5);
      }
    });

    // Sarakkeet
    BLUE_COLS.forEach((col, idx) => {
      const done = col.every(v => state._blueHits.has(v));
      if (done && !state._blueColAwarded.has(idx)){
        state._blueColAwarded.add(idx);
        if (idx === 0) autoAddPlusOne();
        if (idx === 1) safeCall("bonusMarkPurpleValue", 6);
        if (idx === 2) autoAddFox();
        if (idx === 3) autoAddReroll();
      }
    });
	if (typeof updateBlueBonusBadges === "function") updateBlueBonusBadges();

  }

  // --- Merkinnän rekisteröinti ---
  function onBlueMarked(val){
    if (typeof val !== "number") return;
    ensureBlueState();
    state._blueHits.add(val);
    checkBlueCompletions();
  }

  // --- Kiedo tryMarkBlue: bonukset vain oikeasta onnistumisesta ---
  if (typeof tryMarkBlue === "function" && !window.__blueHookUnified){
    const __origTryMarkBlue = tryMarkBlue;
    window.__blueHookUnified = true;

    window.tryMarkBlue = function(val){
      const before = !!(state?.sheet?.blue?.marked && state.sheet.blue.marked[val]);
      const ret = __origTryMarkBlue(val);           // tämä tekee merkinnän jos val on oikea summa jne.
      const after = !!(state?.sheet?.blue?.marked && state.sheet.blue.marked[val]);

      if (!before && after){
        onBlueMarked(val);                           // nyt vasta tarkistetaan rivit/sarakkeet
      }
      return ret;
    };
  }

  // --- Nollaa seurantatilat uuden pelin alussa ---
  if (typeof newGame === "function" && !window.__blueResetUnified){
    const __origNewGame = newGame;
    window.__blueResetUnified = true;

    window.newGame = function(){
      state._blueHits       = new Set();
      state._blueRowAwarded = new Set();
      state._blueColAwarded = new Set();
      state._foxCount       = 0;
      return __origNewGame();
    };
  }
})();
/* ===== Yellow grid bonuses wrapper (auto-apply, non-invasive) ===== */
(function(){
  if (typeof window === "undefined") { window = {}; }

  // 4x4 keltainen
  const N = 4;

  // Rivi-bonukset (ylhäältä alas 0..3):
  // 0 → oranssi 5
  // 1 → ↻
  // 2 → vihreä rasti
  // 3 → violetti 6
  const YELLOW_ROW_BONUS = [
    "ORANGE_5",   // row 0
    "REROLL",     // row 1
    "GREEN_MARK", // row 2
    "PURPLE_6"    // row 3
  ];

  // Pystysarakkeiden extrapisteet (vasemmalta oikealle 0..3):
  // 0 → +10, 1 → +14, 2 → +16, 3 → +20
  const YELLOW_COL_EXTRAPTS = [10, 14, 16, 20];

  // Tilat (ei kosketa projektin omia nimiä)
  function ensureYellowState(){
    if (!state._yellowRowAwarded) state._yellowRowAwarded = new Set();
    if (!state._yellowColAwarded) state._yellowColAwarded = new Set();
    if (state._yellowExtraPoints == null) state._yellowExtraPoints = 0; // kertyy pistelaskuun
    if (state._foxCount == null) state._foxCount = 0; // jos muualla käytössä
  }
  ensureYellowState();

  // Apurit
  function autoAddReroll(){
    state.rerolls = (state.rerolls||0) + 1;
    if (typeof updateHUD === "function") updateHUD();
    setStatus && setStatus("Keltainen: Uusinta (↻)");
  }
  function safeCall(fnName, ...args){
    const fn = (typeof window[fnName] === "function") ? window[fnName] :
               (typeof globalThis[fnName] === "function" ? globalThis[fnName] : null);
    if (fn) return fn(...args);
    setStatus && setStatus(`Keltainen bonus: '${fnName}' puuttuu – lisää apurifunktio.`);
    return false;
  }

  // Indeksit riviin/sarakkeeseen
  const rowIdxs = r => Array.from({length:N}, (_,c)=> r*N + c);
  const colIdxs = c => Array.from({length:N}, (_,r)=> r*N + c);

  // Lue merkinnät datasta + DOMista (prefill huomioiden)
  function getMarkedSet(){
    const set = new Set();
    if (state?.sheet?.yellow?.marked instanceof Set){
      state.sheet.yellow.marked.forEach(i => set.add(+i));
    }
    const wrap = document.getElementById("yellow-grid");
    if (wrap){
      wrap.querySelectorAll(".cell.marked").forEach(cell=>{
        const i = +cell.dataset.idx;
        if (!Number.isNaN(i)) set.add(i);
      });
    }
    return set;
  }

  // Palkitse rivi
  function awardRow(r){
    if (state._yellowRowAwarded.has(r)) return;
    state._yellowRowAwarded.add(r);
    const b = YELLOW_ROW_BONUS[r];
    if (b === "ORANGE_5")   safeCall("bonusMarkOrangeValue", 5);
    if (b === "REROLL")     autoAddReroll();
    if (b === "GREEN_MARK") safeCall("bonusMarkGreenNext");
    if (b === "PURPLE_6")   safeCall("bonusMarkPurpleValue", 6);
  }

  // Palkitse sarake (extrapisteitä, ei välitöntä toiminnallista bonusta)
 function awardCol(c){
  if (state._yellowColAwarded.has(c)) return;      // estä tuplaus
  state._yellowColAwarded.add(c);

  const pts = YELLOW_COL_EXTRAPTS[c] || 0;         // [10,14,16,20]
  state._yellowExtraPoints = (state._yellowExtraPoints || 0) + pts;

  setStatus && setStatus(`Keltainen: sarake ${c+1} valmis → extrapisteet +${pts}`);
  if (typeof updateYellowBonusBadges === "function") updateYellowBonusBadges();
}


  // Tarkista täyttyneet rivit/sarakkeet
  function checkYellowCompletions(){
    ensureYellowState();
    const marked = getMarkedSet();

    // Rivit
    for (let r=0; r<N; r++){
      const done = rowIdxs(r).every(i => marked.has(i));
      if (done && !state._yellowRowAwarded.has(r)) awardRow(r);
    }
    // Sarakkeet
    for (let c=0; c<N; c++){
      const done = colIdxs(c).every(i => marked.has(i));
      if (done && !state._yellowColAwarded.has(c)) awardCol(c);
    }
	// awardRow(r) ja awardCol(c) lopussa:
    if (typeof updateYellowBonusBadges === "function") updateYellowBonusBadges();

  }

  // Havaitse uudet merkinnät (vain toteutuneista)
  let _observer;
  function startObserver(){
    const wrap = document.getElementById("yellow-grid");
    if (!wrap) return;
    if (_observer) _observer.disconnect();

    // Alku­tilanne → älä palkitse jo olemassa olevia keskeneräisiä prefillejä.
    // Täydet rivit/sarakkeet voidaan palkita tässä heti (esim. jos peli alkaa valmiilla täysillä riveillä),
    // tai vaihtoehtoisesti vasta uusien merkintöjen jälkeen. Valitaan maltillinen: palkitaan heti täysiksi
    // täyttyneet prefillit, jotta tila pysyy konsistenttina.
    checkYellowCompletions();

    _observer = new MutationObserver((mutList)=>{
      let changed = false;
      for (const m of mutList){
        if (m.type === "attributes" && m.attributeName === "class"){
          const el = m.target;
          if (el.classList && el.classList.contains("cell") && el.classList.contains("marked")){
            changed = true;
          }
        }
        if (m.type === "childList") changed = true;
      }
      if (changed){
        // Pieni viive, jotta state.sheet.yellow.marked ehtii päivittyä
        setTimeout(checkYellowCompletions, 0);
      }
    });
    _observer.observe(wrap, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
  }

  // newGame-hook resetille + observerin käynnistys
  if (typeof newGame === "function" && !window.__yellowBonusResetPatched){
    const __origNewGame = newGame;
    window.__yellowBonusResetPatched = true;

    window.newGame = function(){
      ensureYellowState();
      state._yellowRowAwarded = new Set();
      state._yellowColAwarded = new Set();
      state._yellowExtraPoints = 0; // aloita alusta jokaisessa pelissä
      const ret = __origNewGame();
      setTimeout(startObserver, 0);
      return ret;
    };
  } else {
    // jos newGame-hook ei ole käytössä heti
    setTimeout(startObserver, 0);
  }

})();
/* ===== GOP (Green-Orange-Purple) bonuses wrapper (non-invasive) ===== */
(function(){
  if (typeof window === "undefined") { window = {}; }

  // ------------------------------------------------------------
  // 1) KONFIGUROITAVAT MILESTONET
  // ------------------------------------------------------------
  // Milestone määritellään indeksin perusteella (seuraavan vapaan kohdan indeksi, 0-pohjainen).
  // Kun juuri MERKITTY indeksi vastaa jotain näistä, jaossa on vastaava bonus.
  //
  // Sallitut bonus-tyypit:
  //  - "PLUS_ONE"
  //  - "REROLL"
  //  - { type:"ORANGE", value:5 }      // merkitse oranssiin arvo (bonusMarkOrangeValue)
  //  - { type:"PURPLE", value:6 }      // merkitse violettiin arvo (bonusMarkPurpleValue)
  //  - "GREEN_MARK"                    // bonusMarkGreenNext()
  //  - "YELLOW_RANDOM"                 // bonusMarkYellowRandom()
  //  - { type:"FOX" }                  // lisää fox-laskuriin 1
  //  - { type:"EXTRA_POINTS", value:n } // kerrytetään loppulaskuun, esim. state._extraPoints.g/o/p
  //
  // HUOM: Täytä nämä oman radan pituuden mukaan.
  window.GREEN_MILESTONES = [
    // Esimerkit (POISTA tai MUOKKAA):
    { idx: 2, bonus: "PLUS_ONE" },
    { idx: 4, bonus: "REROLL" },
    { idx: 6, bonus: "YELLOW_RANDOM" },
  ];

  window.ORANGE_MILESTONES = [
    // Esimerkit:
    { idx: 2, bonus: "PLUS_ONE" },
    { idx: 5, bonus: "REROLL" },
    { idx: 8, bonus: { type:"PURPLE", value:6 } },
  ];

  window.PURPLE_MILESTONES = [
    // Esimerkit:
    { idx: 2, bonus: "PLUS_ONE" },
    { idx: 5, bonus: { type:"ORANGE", value:5 } },
    { idx: 7, bonus: { type:"FOX" } },
  ];

  // ------------------------------------------------------------
  // 2) TILAT & APURIT
  // ------------------------------------------------------------
  function ensureGOPState(){
    if (!state._g_awarded) state._g_awarded = new Set(); // vihreä: palkitut idx:t
    if (!state._o_awarded) state._o_awarded = new Set(); // oranssi: palkitut idx:t
    if (!state._p_awarded) state._p_awarded = new Set(); // violetti: palkitut idx:t
    if (state._foxCount == null) state._foxCount = 0;
    if (!state._extraPoints) state._extraPoints = { green:0, orange:0, purple:0 };
  }
  ensureGOPState();

  function safeCall(fnName, ...args){
    const fn = (typeof window[fnName] === "function") ? window[fnName]
             : (typeof globalThis[fnName] === "function") ? globalThis[fnName] : null;
    if (fn) return fn(...args);
    setStatus && setStatus(`Bonus: '${fnName}' puuttuu – lisää apurifunktio.`);
    return false;
  }
  function addPlusOne(){ state.plusOnes = (state.plusOnes||0) + 1; updateHUD && updateHUD(); setStatus && setStatus("Bonus: +1"); }
  function addReroll(){ state.rerolls = (state.rerolls||0) + 1; updateHUD && updateHUD(); setStatus && setStatus("Bonus: ↻"); }
  function addFox(){ state._foxCount++; setStatus && setStatus(`Bonus: 🦊 (nyt ${state._foxCount})`); }
  function addExtra(where, n){ if (!state._extraPoints) state._extraPoints={green:0,orange:0,purple:0}; state._extraPoints[where]+= (n||0); setStatus && setStatus(`Bonus: extrapisteet +${n} (${where})`); }

  function awardBonus(scope, idx, bonus){
    // scope: "green" | "orange" | "purple"
    if (scope==="green"){
      if (state._g_awarded.has(idx)) return; state._g_awarded.add(idx);
    } else if (scope==="orange"){
      if (state._o_awarded.has(idx)) return; state._o_awarded.add(idx);
    } else {
      if (state._p_awarded.has(idx)) return; state._p_awarded.add(idx);
    }

    if (bonus === "PLUS_ONE") return addPlusOne();
    if (bonus === "REROLL")   return addReroll();
    if (bonus === "GREEN_MARK") return safeCall("bonusMarkGreenNext");
    if (bonus === "YELLOW_RANDOM") return safeCall("bonusMarkYellowRandom");

    if (typeof bonus === "object" && bonus){
      if (bonus.type === "ORANGE")  return safeCall("bonusMarkOrangeValue", bonus.value||5);
      if (bonus.type === "PURPLE")  return safeCall("bonusMarkPurpleValue", bonus.value||6);
      if (bonus.type === "FOX")     return addFox();
      if (bonus.type === "EXTRA_POINTS") return addExtra(scope, bonus.value||0);
    }
  }

  // ------------------------------------------------------------
  // 3) HOOKIT: tunnista onnistunut MERKINTÄ ja jaa bonus
  // ------------------------------------------------------------

  // ---- ORANSSI ----
  // Teillä: tryMarkOrange(idx) asettaa values[idx]=die.value ja kasvattaa sheet.orange.idx
  if (typeof tryMarkOrange === "function" && !window.__orangeBonusPatched){
    const __origTryMarkOrange = tryMarkOrange;
    window.__orangeBonusPatched = true;

    window.tryMarkOrange = function(idx){
      // tila ennen
      const beforeIdx = state?.sheet?.orange?.idx ?? null;
      const beforeVal = Array.isArray(state?.sheet?.orange?.values) ? state.sheet.orange.values[idx] : undefined;

      const ret = __origTryMarkOrange(idx); // tämä kutsuu diePickedFinalize jne.

      // tila jälkeen: onnistuminen jos indeksi kasvoi TAI ko. slotti täyttyi
      const afterIdx = state?.sheet?.orange?.idx ?? beforeIdx;
      const afterVal = Array.isArray(state?.sheet?.orange?.values) ? state.sheet.orange.values[idx] : beforeVal;
      const success = (afterIdx !== beforeIdx) || (beforeVal == null && afterVal != null);

      if (success){
        // Juuri merkitty kohta on (afterIdx-1) – mutta jos idx-parametri oli pakollinen, käytä sitä.
        const justIdx = (afterIdx !== null && afterIdx > 0) ? afterIdx-1 : idx;
        const ms = ORANGE_MILESTONES.find(m => m.idx === justIdx);
                if (ms) { 
		  awardBonus("orange", justIdx, ms.bonus);
		  if (typeof updateOrangeBonusBadges === "function") updateOrangeBonusBadges(); // ← TÄHÄN
		}
      }
      return ret;
    };
  }

  // ---- VIOLETTI ----
  // Teillä: tryMarkPurple(idx) asettaa values[idx]=val ja kasvattaa sheet.purple.idx
  if (typeof tryMarkPurple === "function" && !window.__purpleBonusPatched){
    const __origTryMarkPurple = tryMarkPurple;
    window.__purpleBonusPatched = true;

    window.tryMarkPurple = function(idx){
      const beforeIdx = state?.sheet?.purple?.idx ?? null;
      const beforeVal = Array.isArray(state?.sheet?.purple?.values) ? state.sheet.purple.values[idx] : undefined;

      const ret = __origTryMarkPurple(idx);

      const afterIdx = state?.sheet?.purple?.idx ?? beforeIdx;
      const afterVal = Array.isArray(state?.sheet?.purple?.values) ? state.sheet.purple.values[idx] : beforeVal;
      const success = (afterIdx !== beforeIdx) || (beforeVal == null && afterVal != null);

      if (success){
        const justIdx = (afterIdx !== null && afterIdx > 0) ? afterIdx-1 : idx;
        const ms = PURPLE_MILESTONES.find(m => m.idx === justIdx);
        if (ms) { 
		  awardBonus("purple", justIdx, ms.bonus);
		  if (typeof updatePurpleBonusBadges === "function") updatePurpleBonusBadges(); // ← TÄHÄN
		}
      }
      return ret;
    };
  }


// ---- VIHREÄ ----
if (typeof tryMarkGreen === "function" && !window.__greenBonusPatched){
  const __origTryMarkGreen = tryMarkGreen;
  window.__greenBonusPatched = true;

  window.tryMarkGreen = function(idx){
    const beforeIdx = state?.sheet?.green?.idx ?? null;
    const ret = __origTryMarkGreen(idx);
    const afterIdx  = state?.sheet?.green?.idx ?? beforeIdx;

    if (afterIdx !== null && afterIdx !== beforeIdx){
      const justIdx = afterIdx - 1;
      const ms = GREEN_MILESTONES.find(m => m.idx === justIdx);
      if (ms) {
        awardBonus("green", justIdx, ms.bonus);
        if (typeof updateGreenBonusBadges === "function") updateGreenBonusBadges(); // ← TÄHÄN
      }
    }
    return ret;
  };
}



  // ------------------------------------------------------------
  // 4) RESET newGame:ssa
  // ------------------------------------------------------------
  if (typeof newGame === "function" && !window.__gopResetPatched){
    const __origNewGame = newGame;
    window.__gopResetPatched = true;

    window.newGame = function(){
      ensureGOPState();
      state._g_awarded = new Set();
      state._o_awarded = new Set();
      state._p_awarded = new Set();
      // jätetään _foxCount ja _extraPoints elämään globaalisti, ELLET halua nollata myös ne:
      // state._foxCount = 0;
      // state._extraPoints = { green:0, orange:0, purple:0 };
      return __origNewGame();
    };
  }
})();
// --- konfigit (pidä samat kuin aiemmin sovittiin) ---
const YELLOW_ROW_BONUS = ["ORANGE_5","REROLL","GREEN_MARK","PURPLE_6"];
const YELLOW_COL_EXTRAPTS = [10,14,16,20];

// Tekstikuvaukset


// Piirrä badge-ikonit. Poistaa vanhat, jotta duplikaatteja ei synny.
function renderYellowBonusBadges(){
  const wrap = document.getElementById("yellow-grid");
  if (!wrap) return;

  // Poista kaikki aiemmat
  wrap.querySelectorAll('.y-badge').forEach(n => n.remove());

  // Rivi-badget (viimeiseen soluun, oikea-alakulma)
  for (let r=0; r<4; r++){
    const idx = r*4 + 3;
    const cell = wrap.querySelector(`.cell[data-idx="${idx}"]`);
    if (!cell) continue;
    const badge = document.createElement('span');
    badge.className = 'y-badge y-badge-row';
    badge.dataset.row = r;
    badge.textContent = rowBonusLabel(YELLOW_ROW_BONUS[r]);
    badge.title = 'Rivibonus';
    cell.appendChild(badge);
  }

  // Sarake-badget (ylimpään soluun, vasen-yläkulma)
  for (let c=0; c<4; c++){
    const idx = c; // ylin rivi
    const cell = wrap.querySelector(`.cell[data-idx="${idx}"]`);
    if (!cell) continue;
    const badge = document.createElement('span');
    badge.className = 'y-badge y-badge-col';
    badge.dataset.col = c;
    badge.textContent = `↓ +${YELLOW_COL_EXTRAPTS[c]}`;
    badge.title = 'Sarakkeen extrapisteet';
    cell.appendChild(badge);
  }
}

// Päivitä "earned" -tila rivien/sarakkeiden mukaan
function updateYellowBonusBadges(){
  const rowSet = state._yellowRowAwarded || new Set();
  const colSet = state._yellowColAwarded || new Set();

  document.querySelectorAll('#yellow-grid .y-badge-row').forEach(el=>{
    const r = +el.dataset.row;
    el.classList.toggle('earned', rowSet.has(r));
  });
  document.querySelectorAll('#yellow-grid .y-badge-col').forEach(el=>{
    const c = +el.dataset.col;
    el.classList.toggle('earned', colSet.has(c));
  });
}

// Pieni label-apuri riveille
function rowBonusLabel(code){
  switch(code){
    case "ORANGE_5":   return "← O5";
    case "REROLL":     return "← ↻";
    case "GREEN_MARK": return "← V✓";
    case "PURPLE_6":   return "← P6";
    default:           return "← Bonus";
  }
}

// ---- SINISEN BONUSMERKIT ----

// Tekstikuvaukset
function blueRowBonusLabel(idx){
  if (idx===0) return "← V✓";
  if (idx===1) return "← K?";
  if (idx===2) return "← O5";
  return "← Bonus";
}
function blueColBonusLabel(idx){
  if (idx===0) return "↓ +1";
  if (idx===1) return "↓ P6";
  if (idx===2) return "↓ 🦊";
  if (idx===3) return "↓ ↻";
  return "↑ Bonus";
}

// Piirtää badge-spanit siniseen trackiin
function renderBlueBonusBadges(){
  const wrap = document.getElementById("blue-track");
  if (!wrap) return;
  // siivoa vanhat
  wrap.querySelectorAll('.b-badge').forEach(n=>n.remove());

  // Rivit: viimeiseen soluun
  const rowDefs = [
    {vals:[10,11,12], idx:0},
    {vals:[6,7,8,9], idx:1},
    {vals:[2,3,4,5], idx:2}
  ];
  rowDefs.forEach(def=>{
    const maxVal = Math.max(...def.vals);
    const cell = wrap.querySelector(`.box[data-val="${maxVal}"]`);
    if (cell){
      const badge = document.createElement('span');
      badge.className = "b-badge b-badge-row";
      badge.dataset.row = def.idx;
      badge.textContent = blueRowBonusLabel(def.idx);
      cell.appendChild(badge);
    }
  });

  // Sarakkeet: kiinnitä ylärivin soluun (2,3,4,5)
  const colDefs = [
    {val:2, idx:0}, // sarake [2,6,10]
    {val:3, idx:1}, // sarake [3,7,11]
    {val:4, idx:2}, // sarake [4,8,12]
    {val:5, idx:3}  // sarake [5,9]
  ];
  colDefs.forEach(def=>{
    const cell = wrap.querySelector(`.box[data-val="${def.val}"]`);
    if (cell){
      const badge = document.createElement('span');
      badge.className = "b-badge b-badge-col";
      badge.dataset.col = def.idx;
      badge.textContent = blueColBonusLabel(def.idx);
      cell.appendChild(badge);
    }
  });
}


// Päivitä “earned”-tila
function updateBlueBonusBadges(){
  const rowSet = state._blueRowAwarded || new Set();
  const colSet = state._blueColAwarded || new Set();

  document.querySelectorAll('#blue-track .b-badge-row').forEach(el=>{
    const r = +el.dataset.row;
    el.classList.toggle('earned', rowSet.has(r));
  });
  document.querySelectorAll('#blue-track .b-badge-col').forEach(el=>{
    const c = +el.dataset.col;
    el.classList.toggle('earned', colSet.has(c));
  });
}

// ---- VIHREÄ BONUSMERKIT ----
// Luo pillereitä oikeisiin slotteihin
function renderGreenBonusBadges(){
  const wrap = document.getElementById("green-row");
  if (!wrap) return;
  // poista vanhat
  wrap.querySelectorAll('.g-badge').forEach(n=>n.remove());

  GREEN_MILESTONES.forEach(ms=>{
    const cell = wrap.querySelector(`.slot[data-idx="${ms.idx}"]`);
    if (cell){
      const badge = document.createElement('span');
      badge.className = "g-badge";
      badge.dataset.idx = ms.idx;
      badge.textContent = bonusLabel(ms.bonus);
      cell.appendChild(badge);
    }
  });
}

// Päivitä earned-tila
function updateGreenBonusBadges(){
  const set = state._g_awarded || new Set();
  document.querySelectorAll('#green-row .g-badge').forEach(el=>{
    const i = +el.dataset.idx;
    el.classList.toggle('earned', set.has(i));
  });
}

// ---- ORANSSI BONUSMERKIT ----
function renderOrangeBonusBadges(){
  const wrap = document.getElementById("orange-row");
  if (!wrap) return;
  wrap.querySelectorAll('.o-badge').forEach(n=>n.remove());

  const MS = window.ORANGE_MILESTONES || [];
  MS.forEach(ms=>{
    const cell = wrap.querySelector(`.slot[data-idx="${ms.idx}"]`);
    if (cell){
      const badge = document.createElement('span');
      badge.className = "o-badge";
      badge.dataset.idx = ms.idx;
      badge.textContent = bonusLabel(ms.bonus);
      cell.appendChild(badge);
    }
  });
}

function updateOrangeBonusBadges(){
  const set = state._o_awarded || new Set();
  document.querySelectorAll('#orange-row .o-badge').forEach(el=>{
    const i = +el.dataset.idx;
    el.classList.toggle('earned', set.has(i));
  });
}
// ---- VIOLETTI BONUSMERKIT ----
function renderPurpleBonusBadges(){
  const wrap = document.getElementById("purple-row");
  if (!wrap) return;
  wrap.querySelectorAll('.p-badge').forEach(n=>n.remove());

  const MS = window.PURPLE_MILESTONES || [];
  MS.forEach(ms=>{
    const cell = wrap.querySelector(`.slot[data-idx="${ms.idx}"]`);
    if (cell){
      const badge = document.createElement('span');
      badge.className = "p-badge";
      badge.dataset.idx = ms.idx;
      badge.textContent = bonusLabel(ms.bonus);
      cell.appendChild(badge);
    }
  });
}

function updatePurpleBonusBadges(){
  const set = state._p_awarded || new Set();
  document.querySelectorAll('#purple-row .p-badge').forEach(el=>{
    const i = +el.dataset.idx;
    el.classList.toggle('earned', set.has(i));
  });
}

function bonusLabel(b){
  if (b==="PLUS_ONE") return "→ +1";
  if (b==="REROLL") return "→ ↻";
  if (b==="GREEN_MARK") return "→ ✓";
  if (b==="YELLOW_RANDOM") return "→ K";
  if (typeof b==="object"){
    if (b.type==="ORANGE") return "→ O"+b.value;
    if (b.type==="PURPLE") return "→ P"+b.value;
    if (b.type==="FOX") return "→ 🦊";
    if (b.type==="EXTRA_POINTS") return "→ +"+b.value;
  }
  return "→ Bonus";
}
