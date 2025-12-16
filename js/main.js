import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";
import { makeMaze, bfsNextStep, resolveMazeCollision } from "./maze.js";
import { makeUI } from "./ui.js";
import { makeAudio } from "./audio.js";
import { loadStory, saveStory, resetStory, markNoteRead, noteAlreadyRead, applyChoice, computeEnding, endingText } from "./story.js";

const ui = makeUI();
const audio = makeAudio();
let story = loadStory();

const state = {
  started: false,
  pausedUI: false,
  level: 1,
  relics: story.relics || 0,
  dissonance: 0,     // 0..100
  warning: 0,        // 0..1
  wet: 1,
  time: 0,
  pointerLocked: false,
};

const LEVELS = [
  { w: 10, h: 10, enemySpeed: 2.3, name: "The Polite Path", requireNote: true },
  { w: 12, h: 12, enemySpeed: 2.7, name: "Trees That Watch", requireNote: true },
  { w: 14, h: 14, enemySpeed: 3.1, name: "Bright Rain, Dark Work", requireNote: false },
  { w: 16, h: 16, enemySpeed: 3.6, name: "The Gate Learns You", requireNote: false },
];

// ---------- Three.js setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
document.getElementById("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaab2b8, 0.045);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 150);
camera.position.set(0, 1.7, 0);

const clock = new THREE.Clock();

const light = new THREE.DirectionalLight(0xffffff, 0.95);
light.position.set(10, 20, 8);
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));

// PS1-ish resolution scale (fast + pixelated)
let resScale = 0.60;

// ---------- World containers ----------
let world = null;

function resize(){
  const W = window.innerWidth, H = window.innerHeight;
  const iw = Math.max(320, Math.floor(W * resScale));
  const ih = Math.max(240, Math.floor(H * resScale));
  renderer.setSize(iw, ih, false);

  // CSS scale to full screen
  renderer.domElement.style.width = W + "px";
  renderer.domElement.style.height = H + "px";

  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Input ----------
const keys = new Set();
window.addEventListener("keydown", (e)=>{
  if(e.code === "KeyQ") toggleJournal();
  keys.add(e.code);
});
window.addEventListener("keyup", (e)=> keys.delete(e.code));

const look = { yaw: 0, pitch: 0 };
window.addEventListener("mousemove", (e)=>{
  if(!state.pointerLocked || state.pausedUI) return;
  const sens = 0.0022;
  look.yaw -= e.movementX * sens;
  look.pitch -= e.movementY * sens;
  look.pitch = Math.max(-1.25, Math.min(1.25, look.pitch));
});

renderer.domElement.addEventListener("click", ()=>{
  if(!state.started){
    startGame();
    return;
  }
  if(!state.pointerLocked && !state.pausedUI){
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", ()=>{
  state.pointerLocked = (document.pointerLockElement === renderer.domElement);
  ui.setHint(state.pointerLocked ? "" : "Click to re-enter. (WASD, SHIFT, E interact, Q journal)", !state.pointerLocked && !state.pausedUI);
});

ui.els.retry.onclick = ()=>{ ui.showDeath(false); loadLevel(state.level); };
ui.els.restartGame.onclick = ()=>{
  ui.showEnding(false);
  resetStory();
  story = loadStory();
  state.relics = 0;
  state.level = 1;
  loadLevel(1);
  renderer.domElement.requestPointerLock();
};

// ---------- Start ----------
function startGame(){
  state.started = true;
  audio.resume();
  ui.setHint("You step into daylight that feels staged. Find the relic. Avoid what follows.", true);
  setTimeout(()=> ui.setHint("", false), 2200);
  loadLevel(state.level);
  renderer.domElement.requestPointerLock();
}

// ---------- Level building ----------
function clearWorld(){
  if(!world) return;
  scene.remove(world.group);
  world = null;
}

function loadLevel(level){
  clearWorld();
  const L = LEVELS[level-1];
  const rng = mulberry32(1000 + level*999 + (story.guilt|0)*7 + (story.obsession|0)*11);

  const maze = makeMaze(L.w, L.h, rng);
  const cellSize = 3.2;

  const group = new THREE.Group();
  scene.add(group);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(L.w*cellSize + 24, L.h*cellSize + 24, 1, 1);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x5a6660 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.set((L.w*cellSize)/2, 0, (L.h*cellSize)/2);
  group.add(ground);

  // Slightly bloody "aftermath" patches (stylized)
  const bloodGeo = new THREE.CircleGeometry(1.2, 14);
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0x4a0b12, transparent:true, opacity:0.65 });
  for(let i=0;i<3+level;i++){
    const b = new THREE.Mesh(bloodGeo, bloodMat);
    b.rotation.x = -Math.PI/2;
    const px = (rng()*L.w*cellSize);
    const pz = (rng()*L.h*cellSize);
    b.position.set(px, 0.02, pz);
    group.add(b);
  }

  // Maze walls
  const wallH = 2.4;
  const wallT = 0.18;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x2b3136 });
  const wallGeoH = new THREE.BoxGeometry(cellSize + wallT, wallH, wallT);
  const wallGeoV = new THREE.BoxGeometry(wallT, wallH, cellSize + wallT);

  const walls = [];

  for(let y=0;y<L.h;y++){
    for(let x=0;x<L.w;x++){
      const c = maze.cells[maze.idx(x,y)];
      const ox = x*cellSize;
      const oz = y*cellSize;

      // North wall
      if(c.N){
        const m = new THREE.Mesh(wallGeoH, wallMat);
        m.position.set(ox + cellSize/2, wallH/2, oz);
        group.add(m); walls.push(m);
      }
      // West wall
      if(c.W){
        const m = new THREE.Mesh(wallGeoV, wallMat);
        m.position.set(ox, wallH/2, oz + cellSize/2);
        group.add(m); walls.push(m);
      }
      // Outer boundaries (E,S)
      if(x === L.w-1 && c.E){
        const m = new THREE.Mesh(wallGeoV, wallMat);
        m.position.set(ox + cellSize, wallH/2, oz + cellSize/2);
        group.add(m); walls.push(m);
      }
      if(y === L.h-1 && c.S){
        const m = new THREE.Mesh(wallGeoH, wallMat);
        m.position.set(ox + cellSize/2, wallH/2, oz + cellSize);
        group.add(m); walls.push(m);
      }
    }
  }

  // Forest trees (instanced low-poly) around + inside edges
  const treeCount = 420;
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
  const leafGeo = new THREE.ConeGeometry(0.9, 2.1, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2f2a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e4a35 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);

  const dummy = new THREE.Object3D();
  const W = L.w*cellSize, H = L.h*cellSize;

  for(let i=0;i<treeCount;i++){
    // scatter: mostly outside maze rect, some near edges
    let x,z;
    if(rng() < 0.75){
      const pad = 10 + rng()*16;
      const side = Math.floor(rng()*4);
      if(side===0){ x = -pad; z = rng()*(H+pad*2) - pad; }
      if(side===1){ x = W + pad; z = rng()*(H+pad*2) - pad; }
      if(side===2){ x = rng()*(W+pad*2) - pad; z = -pad; }
      if(side===3){ x = rng()*(W+pad*2) - pad; z = H + pad; }
    }else{
      x = rng()*W;
      z = rng()*H;
    }

    const s = 0.85 + rng()*0.55;
    const y = 0.7*s;

    dummy.position.set(x, y, z);
    dummy.rotation.y = rng()*Math.PI*2;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, 1.9*s, z);
    dummy.rotation.y = rng()*Math.PI*2;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  group.add(trunks);
  group.add(leaves);

  // Rain particles (fast Points)
  const rainCount = 1200 + level*500;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount*3);
  for(let i=0;i<rainCount;i++){
    rainPos[i*3+0] = (rng()*(W+30)) - 10;
    rainPos[i*3+1] = 2 + rng()*18;
    rainPos[i*3+2] = (rng()*(H+30)) - 10;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xd9e6ee, size: 0.07 });
  const rain = new THREE.Points(rainGeo, rainMat);
  group.add(rain);

  // Start/exit cells
  const start = { x:0, y:0 };
  const exit = maze.farthestFrom(start.x, start.y);

  // Player spawn at start
  const spawn = cellCenter(start.x,start.y,cellSize);
  camera.position.set(spawn.x, 1.7, spawn.z);
  look.yaw = 0; look.pitch = 0;

  // Gate at exit
  const gateGeo = new THREE.BoxGeometry(1.6, 2.2, 0.22);
  const gateMat = new THREE.MeshLambertMaterial({ color: 0x6b747b });
  const gate = new THREE.Mesh(gateGeo, gateMat);
  const gpos = cellCenter(exit.x, exit.y, cellSize);
  gate.position.set(gpos.x, 1.1, gpos.z);
  group.add(gate);

  // Relic in a far-ish cell (not necessarily exit)
  const relicCell = pickRelicCell(maze, start, exit, rng);
  const relicPos = cellCenter(relicCell.x, relicCell.y, cellSize);

  const relic = makeRelicMesh(level);
  relic.position.set(relicPos.x, 1.0, relicPos.z);
  group.add(relic);

  // Notes: 3 per level; one might include a choice
  const notes = [];
  for(let i=0;i<3;i++){
    const nc = pickNoteCell(maze, start, exit, relicCell, rng);
    const np = cellCenter(nc.x, nc.y, cellSize);
    const n = makeNoteMesh();
    n.position.set(np.x + (rng()*0.6-0.3), 0.6, np.z + (rng()*0.6-0.3));
    n.userData.noteId = `L${level}_N${i}`;
    n.userData.noteIndex = i;
    notes.push(n);
    group.add(n);
  }

  // Entity (the follower)
  const enemyCell = maze.farthestFrom(exit.x, exit.y);
  const enemyPos = cellCenter(enemyCell.x, enemyCell.y, cellSize);
  const enemy = makeEntityMesh();
  enemy.position.set(enemyPos.x, 1.15, enemyPos.z);
  group.add(enemy);

  world = {
    group, maze, cellSize,
    start, exit,
    gate, gateOpen: false,
    relic, relicTaken: false,
    relicCell,
    notes,
    enemy,
    enemyCell,
    enemyTargetCell: enemyCell,
    enemyPathTimer: 0,
    enemySpeed: L.enemySpeed,
    requireNote: L.requireNote,
    requiredNoteRead: !L.requireNote,
    levelName: L.name,
    rain,
    rainVel: 10.5 + level*1.5,
    lastInteractHint: "",
  };

  ui.setTop({
    level: state.level,
    relics: state.relics,
    mission: `MISSION: FIND RELIC • ${world.levelName}`,
    dissonance: state.dissonance
  });

  // opening text (2nd person)
  const intro = [
    `You step into daylight that feels borrowed.`,
    `Rain insists on being counted, drop by drop.`,
    `Somewhere ahead, a relic is waiting to be remembered.`
  ];
  ui.setHint(intro[level-1] || intro[0], true);
  setTimeout(()=> ui.setHint("", false), 2400);

  // If required note, gate is "locked" until you read any note
  if(world.requireNote){
    world.gate.material.color.setHex(0x566068);
  }else{
    world.gate.material.color.setHex(0x7c878f);
  }

  // A tiny stinger on higher levels
  if(level >= 3) audio.stinger(0.55);
}

// ---------- Mesh factories ----------
function makeRelicMesh(level){
  const g = new THREE.IcosahedronGeometry(0.45 + level*0.03, 0);
  const m = new THREE.MeshLambertMaterial({ color: 0xc6c0a3, emissive: 0x0c0a08 });
  const mesh = new THREE.Mesh(g,m);
  mesh.userData.type = "relic";
  return mesh;
}

function makeNoteMesh(){
  const g = new THREE.BoxGeometry(0.5, 0.25, 0.04);
  const m = new THREE.MeshLambertMaterial({ color: 0xd8d1c4 });
  const mesh = new THREE.Mesh(g,m);
  mesh.userData.type = "note";
  return mesh;
}

function makeEntityMesh(){
  // low poly, unsettling silhouette
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 2.0, 7),
    new THREE.MeshLambertMaterial({ color: 0x16191c })
  );
  body.position.y = 1.0;
  group.add(body);

  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xfff3e0 })
  );
  face.position.set(0, 1.35, 0.33);
  group.add(face);

  group.userData.type = "enemy";
  return group;
}

// ---------- Placement helpers ----------
function cellCenter(x,y,cellSize){
  return { x: x*cellSize + cellSize/2, z: y*cellSize + cellSize/2 };
}

function pickRelicCell(maze, start, exit, rng){
  // pick among far cells, avoid exit and start
  let best = exit;
  for(let i=0;i<18;i++){
    const x = (rng()*maze.w)|0;
    const y = (rng()*maze.h)|0;
    if((x===start.x&&y===start.y) || (x===exit.x&&y===exit.y)) continue;
    best = {x,y};
  }
  return best;
}

function pickNoteCell(maze, start, exit, relicCell, rng){
  for(let tries=0; tries<80; tries++){
    const x = (rng()*maze.w)|0;
    const y = (rng()*maze.h)|0;
    if((x===start.x&&y===start.y) || (x===exit.x&&y===exit.y)) continue;
    if(x===relicCell.x && y===relicCell.y) continue;
    return {x,y};
  }
  return {x:1,y:1};
}

// ---------- Interaction / UI narrative ----------
function toggleJournal(){
  if(!state.started) return;
  if(ui.els.journal.classList.contains("hidden")){
    state.pausedUI = true;
    document.exitPointerLock?.();
    ui.openJournal(renderJournal());
    ui.setHint("", false);
  }else{
    ui.closeJournal();
    state.pausedUI = false;
    ui.setHint("Click to re-enter.", true);
  }
}

function renderJournal(){
  const c = story.choices;
  const pick = (v)=> v ? `<b>${v}</b>` : `<i>unanswered</i>`;
  return `
    <p>You keep a record because the forest rewrites memory.</p>
    <p><b>Relics recovered:</b> ${state.relics}/4</p>
    <p><b>Notes read:</b> ${story.notesRead.length}</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.16);margin:12px 0;">
    <p><b>Answers you gave (the forest remembers):</b></p>
    <p>• Mercy: ${pick(c.mercy)}</p>
    <p>• Truth: ${pick(c.truth)}</p>
    <p>• Name: ${pick(c.name)}</p>
    <p>• Hunger: ${pick(c.hunger)}</p>
    <p style="margin-top:10px;"><b>Private meters:</b></p>
    <p>• Guilt: ${story.guilt}/100</p>
    <p>• Obsession: ${story.obsession}/100</p>
    <p style="margin-top:10px;color:#ffffff77;">You are addressed in second person because you are being instructed.</p>
  `;
}

function openNote(noteMesh){
  const id = noteMesh.userData.noteId;
  const idx = noteMesh.userData.noteIndex;

  const already = noteAlreadyRead(story, id);
  if(!already){
    markNoteRead(story, id);
    saveStory(story);
  }

  // Reading a note can unlock gate on levels requiring it
  if(world && world.requireNote) world.requiredNoteRead = true;

  const payload = buildNotePayload(state.level, idx, already);
  state.pausedUI = true;
  document.exitPointerLock?.();

  ui.openModal({
    title: payload.title,
    html: payload.html,
    choices: payload.choices || []
  });
}

function buildNotePayload(level, idx, already){
  // Second-person horror notes with occasional choice
  const commonLead = `<p>You read it because the rain insists your hands stay busy.</p>`;
  const seen = already ? `<p style="color:#ffffff66;">(You’ve read this before. It reads you back.)</p>` : "";

  // Each level has one choice note
  const isChoice = (idx === 1);

  if(level === 1){
    if(!isChoice){
      return {
        title: "NOTE: DAYLIGHT DOESN'T MEAN SAFE",
        html: `${commonLead}${seen}
          <p><b>“The forest is brightest where it hides the most.</b> If you feel watched, it’s because you are the part worth watching.”</p>
          <p>There’s dried rust-brown staining on the bottom edge. Not paint.</p>`
      };
    }
    return {
      title: "QUESTION: MERCY",
      html: `${commonLead}${seen}
        <p>On the paper: a child’s map of this maze.</p>
        <p>In the margin, a sentence written in adult pressure:</p>
        <p><b>“If the thing follows you, do you let it come close so it can be understood?”</b></p>
        <p>You feel the forest waiting for your answer.</p>`,
      choices: [
        { label: "Answer: MERCY (let it approach)", onPick: ()=> pickChoice("mercy","mercy") },
        { label: "Answer: STRICT (never let it near)", onPick: ()=> pickChoice("mercy","strict") },
      ]
    };
  }

  if(level === 2){
    if(!isChoice){
      return {
        title: "NOTE: THE TREES PRACTICE YOUR NAME",
        html: `${commonLead}${seen}
          <p><b>“Every footstep is a vote.</b> The maze counts them. The rain recounts them.”</p>
          <p>Someone drew a doorway that leads back to itself.</p>`
      };
    }
    return {
      title: "QUESTION: TRUTH",
      html: `${commonLead}${seen}
        <p><b>“When you’re found, do you confess what you were looking for?”</b></p>
        <p>Your tongue feels heavy, as if it already knows the lie.</p>`,
      choices: [
        { label: "Answer: CONFESS", onPick: ()=> pickChoice("truth","confess") },
        { label: "Answer: DENY", onPick: ()=> pickChoice("truth","deny") },
      ]
    };
  }

  if(level === 3){
    if(!isChoice){
      return {
        title: "NOTE: GORE WITHOUT THE SCENE",
        html: `${commonLead}${seen}
          <p>You find a smear of dark red on bark—old, rain-fed, stubborn.</p>
          <p><b>“The body is a rumor here.</b> Only the consequences are allowed to remain.”</p>
          <p>Your stomach tries to become a smaller organ.</p>`
      };
    }
    return {
      title: "QUESTION: NAME",
      html: `${commonLead}${seen}
        <p><b>“If the forest offers you a new name, do you accept it?”</b></p>
        <p>Daylight makes the question feel administrative.</p>`,
      choices: [
        { label: "Answer: ACCEPT", onPick: ()=> pickChoice("name","accept") },
        { label: "Answer: REFUSE", onPick: ()=> pickChoice("name","refuse") },
      ]
    };
  }

  // level 4
  if(!isChoice){
    return {
      title: "NOTE: THE GATE LEARNS YOU",
      html: `${commonLead}${seen}
        <p><b>“Keys are only metaphors for permission.</b> You’ve been giving permission the whole time.”</p>
        <p>Someone pressed a wet thumbprint into the paper. It looks fresh.</p>`
    };
  }
  return {
    title: "QUESTION: HUNGER",
    html: `${commonLead}${seen}
      <p><b>“If it follows you because it’s hungry, do you feed it?”</b></p>
      <p>You can almost hear it swallowing the distance.</p>`,
    choices: [
      { label: "Answer: FEED IT (offer the relic)", onPick: ()=> pickChoice("hunger","feed") },
      { label: "Answer: STARVE IT (keep the relic)", onPick: ()=> pickChoice("hunger","starve") },
    ]
  };
}

function pickChoice(key, value){
  applyChoice(story, key, value);
  saveStory(story);
  ui.closeModal();
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
  audio.stinger(0.55);
}

// ---------- Gameplay loop ----------
function update(dt){
  if(!world) return;

  state.time += dt;

  // Rain motion
  const p = world.rain.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    let y = p.getY(i) - world.rainVel*dt;
    if(y < 0.2) y = 18 + Math.random()*6;
    p.setY(i, y);
  }
  p.needsUpdate = true;

  // Player movement
  const speedWalk = 3.2;
  const speedSprint = 5.3;
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = sprint ? speedSprint : speedWalk;

  // Dissonance can cause slight "hesitation" (not flipped controls)
  const d = state.dissonance/100;
  const sluggish = 1 - d*0.18;

  const forward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
  const strafe  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0);

  const vx = (Math.sin(look.yaw)*forward + Math.sin(look.yaw + Math.PI/2)*strafe);
  const vz = (Math.cos(look.yaw)*forward + Math.cos(look.yaw + Math.PI/2)*strafe);

  const len = Math.hypot(vx, vz) || 1;
  const mx = (vx/len) * speed * dt * sluggish;
  const mz = (vz/len) * speed * dt * sluggish;

  if(!state.pausedUI){
    camera.position.x += mx;
    camera.position.z += mz;
    resolveMazeCollision(camera.position, world.maze, world.cellSize, 0.35);
  }

  // Camera orientation
  camera.rotation.order = "YXZ";
  camera.rotation.y = look.yaw;
  camera.rotation.x = look.pitch + Math.sin(state.time*0.9)*0.01*(d*1.5); // mild nausea at high dissonance

  // Interactions
  if(!state.pausedUI && keys.has("KeyE")){
    tryInteract();
  }

  // Enemy AI
  world.enemyPathTimer -= dt;
  const playerCell = getCell(camera.position, world.cellSize, world.maze);
  const enemyCell = getCell(world.enemy.position, world.cellSize, world.maze);
  world.enemyCell = enemyCell;

  if(world.enemyPathTimer <= 0){
    world.enemyTargetCell = bfsNextStep(world.maze, enemyCell, playerCell);
    world.enemyPathTimer = 0.45; // update rate
  }

  // Move enemy towards target cell center
  const targetPos = cellCenter(world.enemyTargetCell.x, world.enemyTargetCell.y, world.cellSize);
  const ex = targetPos.x - world.enemy.position.x;
  const ez = targetPos.z - world.enemy.position.z;
  const ed = Math.hypot(ex, ez) || 1;

  // Enemy speed varies with story (psychological)
  let eSpeed = world.enemySpeed;
  if(story.choices.mercy === "mercy") eSpeed *= 0.92;   // you "understand" it a bit
  if(story.choices.truth === "deny") eSpeed *= 1.07;    // lies make it brisk
  if(story.obsession > 65) eSpeed *= 1.05;

  world.enemy.position.x += (ex/ed) * eSpeed * dt;
  world.enemy.position.z += (ez/ed) * eSpeed * dt;

  // Face towards player, slightly jittery
  world.enemy.rotation.y = Math.atan2(
    camera.position.x - world.enemy.position.x,
    camera.position.z - world.enemy.position.z
  ) + Math.sin(state.time*11)*0.03;

  // Distance effects
  const dist = world.enemy.position.distanceTo(camera.position);
  const close = smoothstep(10, 2.8, dist); // 0 far -> 1 near
  state.warning = close;

  // Dissonance rises with proximity + staring (angle)
  const toEnemy = new THREE.Vector3().subVectors(world.enemy.position, camera.position).normalize();
  const lookDir = new THREE.Vector3(0,0,-1).applyEuler(camera.rotation).normalize();
  const stare = Math.max(0, lookDir.dot(toEnemy)); // 0..1
  const targetD = clamp01(close*0.9 + stare*0.35) * 100;

  // Add subtle story-driven baseline dissonance
  const baseline = (story.guilt*0.25 + story.obsession*0.18);
  const desired = Math.max(targetD, baseline);

  state.dissonance += (desired - state.dissonance) * (1 - Math.exp(-dt*0.9));
  state.dissonance = clamp(state.dissonance, 0, 100);
  audio.setDissonance(state.dissonance/100);

  // Catch / death
  if(dist < 1.25 && !state.pausedUI){
    onDeath();
  }

  // Gate becomes usable
  if(world.requireNote && world.requiredNoteRead && !world.gateOpen){
    world.gateOpen = true;
    world.gate.material.color.setHex(0x8e999f);
  }

  // Animate relic slightly
  if(!world.relicTaken){
    world.relic.rotation.y += dt*0.8;
    world.relic.position.y = 1.0 + Math.sin(state.time*2.4)*0.08;
  }

  // Update HUD
  ui.setTop({
    level: state.level,
    relics: state.relics,
    mission: buildMission(),
    dissonance: state.dissonance
  });

  // FX overlay
  ui.drawFX({
    dissonance: state.dissonance,
    wet: state.wet,
    t: state.time,
    warning: state.warning
  });
}

function buildMission(){
  const L = LEVELS[state.level-1];
  if(!world) return "MISSION: ...";
  if(!world.relicTaken){
    return L.requireNote && !world.requiredNoteRead
      ? "MISSION: READ A NOTE • THEN FIND RELIC"
      : "MISSION: FIND THE RELIC";
  }
  return "MISSION: REACH THE GATE";
}

function tryInteract(){
  // edge-trigger (so holding E doesn't spam)
  if(world._eLatch) return;
  world._eLatch = true;
  setTimeout(()=> world && (world._eLatch=false), 140);

  const here = camera.position;

  // Notes
  for(const n of world.notes){
    if(!n.visible) continue;
    if(n.position.distanceTo(here) < 1.5){
      openNote(n);
      return;
    }
  }

  // Relic
  if(!world.relicTaken && world.relic.position.distanceTo(here) < 1.8){
    world.relicTaken = true;
    world.relic.visible = false;

    state.relics += 1;
    story.relics = state.relics;
    saveStory(story);

    audio.stinger(0.75);

    ui.setHint("You take the relic. It feels like you’ve stolen a memory from yourself.", true);
    setTimeout(()=> ui.setHint("", false), 2200);
    return;
  }

  // Gate
  if(world.gate.position.distanceTo(here) < 2.2){
    if(world.requireNote && !world.requiredNoteRead){
      ui.setHint("The gate is inert. The forest wants you to read first.", true);
      setTimeout(()=> ui.setHint("", false), 1400);
      return;
    }
    if(!world.relicTaken){
      ui.setHint("You reach for the gate, but you are missing something.", true);
      setTimeout(()=> ui.setHint("", false), 1400);
      return;
    }
    // advance
    nextLevelOrEnd();
  }
}

function nextLevelOrEnd(){
  if(state.level < 4){
    state.level += 1;
    loadLevel(state.level);
    return;
  }
  // end game
  const ending = computeEnding(story);
  const html = endingText(ending, story);
  ui.showEnding(true, html);
  state.pausedUI = true;
  document.exitPointerLock?.();
}

function onDeath(){
  state.pausedUI = true;
  document.exitPointerLock?.();
  ui.showDeath(true);
  audio.stinger(0.9);
}

// ---------- Loop ----------
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.033, clock.getDelta());
  if(state.started && !ui.els.death.classList.contains("hidden") === false && !ui.els.ending.classList.contains("hidden") === false){
    // keep rendering even on UI, but don't move if pausedUI
  }
  if(state.started){
    update(dt);
    renderer.render(scene, camera);
  }else{
    // idle FX
    ui.drawFX({ dissonance: 0, wet: 1, t: performance.now()/1000, warning: 0 });
  }
}
animate();

// ---------- Helpers ----------
function getCell(pos, cellSize, maze){
  const x = clamp(Math.floor(pos.x / cellSize), 0, maze.w-1);
  const y = clamp(Math.floor(pos.z / cellSize), 0, maze.h-1);
  return {x,y};
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function clamp01(v){ return clamp(v,0,1); }
function smoothstep(edge0, edge1, x){
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t*t*(3 - 2*t);
}

function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Close modal resumes play hint
ui.els.closeModal.addEventListener("click", ()=>{
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
});
ui.els.closeJournal.addEventListener("click", ()=>{
  state.pausedUI = false;
  ui.setHint("Click to re-enter.", true);
});

