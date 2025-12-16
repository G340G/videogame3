// Branching narrative state (stored in localStorage)
const KEY = "rf_story_v1";

export function loadStory(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return fresh();
    const s = JSON.parse(raw);
    return { ...fresh(), ...s };
  }catch{
    return fresh();
  }
}

export function saveStory(state){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch{}
}

export function resetStory(){
  try{ localStorage.removeItem(KEY); }catch{}
}

function fresh(){
  return {
    choices: {
      mercy: null,      // "mercy" | "strict"
      truth: null,      // "confess" | "deny"
      name: null,       // "accept" | "refuse"
      hunger: null,     // "feed" | "starve"
    },
    notesRead: [],
    relics: 0,
    endingsSeen: [],
    // experimental variables:
    guilt: 0,          // 0..100
    obsession: 0,      // 0..100
  };
}

export function noteAlreadyRead(state, id){
  return state.notesRead.includes(id);
}

export function markNoteRead(state, id){
  if(!state.notesRead.includes(id)) state.notesRead.push(id);
}

export function applyChoice(state, key, value){
  state.choices[key] = value;
  // Consequences: subtle, gameplay-affecting, narrative-altering
  if(key === "mercy"){
    state.guilt += (value === "strict" ? 20 : -10);
    state.obsession += (value === "mercy" ? 10 : 0);
  }
  if(key === "truth"){
    state.guilt += (value === "deny" ? 25 : -5);
    state.obsession += (value === "confess" ? 10 : 0);
  }
  if(key === "name"){
    state.obsession += (value === "accept" ? 25 : -5);
  }
  if(key === "hunger"){
    state.guilt += (value === "feed" ? 10 : 30);
  }

  state.guilt = clamp(state.guilt, 0, 100);
  state.obsession = clamp(state.obsession, 0, 100);
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export function computeEnding(state){
  // Weight choices + meters into 3 endings
  const c = state.choices;
  const score =
    (c.mercy === "mercy" ? 1 : 0) +
    (c.truth === "confess" ? 1 : 0) +
    (c.name === "refuse" ? 1 : 0) +
    (c.hunger === "feed" ? 1 : 0);

  const dark = (state.guilt + state.obsession) / 2;

  if(score >= 3 && dark < 55) return "CLEARING";
  if(score <= 1 && dark > 60) return "USHER";
  return "LOOP";
}

export function endingText(ending, state){
  const you = `You are not the camera. You are the person being framed.`;
  if(ending === "CLEARING"){
    return `
<p>${you}</p>
<p>You place the four relics on wet stone. The rain slows as if it is listening.</p>
<p>The forest stops pretending. A path appears in the daylight, bright and embarrassingly ordinary.</p>
<p>You don’t feel forgiven—just released. The entity stays behind the trees, polite enough to let you leave.</p>
<p><b>ENDING: THE CLEARING</b></p>
`;
  }
  if(ending === "USHER"){
    return `
<p>${you}</p>
<p>You assemble the relics and immediately understand: they weren’t keys. They were invitations.</p>
<p>The thing in the rain steps closer. It doesn’t run. It doesn’t need to.</p>
<p>You realize the forest has been rehearsing your footsteps for years.</p>
<p><b>ENDING: THE USHER</b></p>
`;
  }
  return `
<p>${you}</p>
<p>You collect everything. You do everything “right.”</p>
<p>The gate opens onto the same gate. The daylight repeats itself. The rain repeats itself.</p>
<p>Your journal now contains notes you don’t remember writing in your own voice.</p>
<p><b>ENDING: THE LOOP</b></p>
`;
}
