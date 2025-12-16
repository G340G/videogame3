import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";
import { bfsNextStep } from "./maze.js";

export function spawnNPCs({ rng, maze, cellSize, level }){
  const count = 1 + Math.min(3, level); // 2..4-ish across game
  const npcs = [];

  for(let i=0;i<count;i++){
    const cell = { x: (rng()*maze.w)|0, y: (rng()*maze.h)|0 };
    const pos = cellCenter(cell.x, cell.y, cellSize);
    const npc = makeNPCMesh(rng, pickArchetype(rng, level, i));
    npc.position.set(pos.x, 0.95, pos.z);
    npc.userData.cell = cell;
    npc.userData.targetCell = cell;
    npc.userData.timer = 0;
    npc.userData.speed = 1.3 + rng()*0.6 + level*0.06;
    npc.userData.id = `NPC_L${level}_${i}`;
    npc.userData.lastSpoke = 0;
    npcs.push(npc);
  }

  return npcs;
}

export function updateNPCs({ dt, time, npcs, maze, cellSize, playerPos, dissonanceRef }){
  for(const n of npcs){
    n.userData.timer -= dt;

    // If close, sometimes stop + stare (psych pressure)
    const dist = n.position.distanceTo(playerPos);
    const stare = dist < 3.4;

    if(stare){
      // freeze wander a bit
      n.userData.timer = Math.min(n.userData.timer, 0.0);
      // add a little dissonance pressure (small)
      dissonanceRef.add( (3.4 - dist) * 0.6 * dt );
      // face player
      n.rotation.y = Math.atan2(playerPos.x - n.position.x, playerPos.z - n.position.z);
    }else{
      // wander target update
      if(n.userData.timer <= 0){
        n.userData.targetCell = {
          x: clamp((rngish(n.userData.id, time*0.07)*maze.w)|0, 0, maze.w-1),
          y: clamp((rngish(n.userData.id, time*0.09+3)*maze.h)|0, 0, maze.h-1),
        };
        n.userData.timer = 2.0 + (hash01(n.userData.id)*3.0);
      }

      const curCell = getCell(n.position, cellSize, maze);
      const step = bfsNextStep(maze, curCell, n.userData.targetCell);
      const targetPos = cellCenter(step.x, step.y, cellSize);

      const ex = targetPos.x - n.position.x;
      const ez = targetPos.z - n.position.z;
      const ed = Math.hypot(ex, ez) || 1;

      n.position.x += (ex/ed) * n.userData.speed * dt;
      n.position.z += (ez/ed) * n.userData.speed * dt;

      n.rotation.y = Math.atan2(ex, ez);
    }

    // subtle jitter (PS1-ish “bad animation”)
    n.position.y = 0.95 + Math.sin(time*3 + hash01(n.userData.id)*10)*0.02;
  }
}

export function npcInteractPayload(npc, level, story){
  const a = npc.userData.archetype;

  const lead = `<p>You address them in your head, because saying it out loud feels like summoning.</p>`;
  const hint = directionHint(a, level);

  // Some NPCs can force a choice (experimental bargain)
  if(a.kind === "BUTCHER"){
    return {
      title: "A PERSON WHO SMELLS LIKE IRON",
      html: `${lead}
        <p>They smile as if they’ve practiced on people who begged.</p>
        <p><b>“You want the relic? Then stop running from it.”</b></p>
        <p>They point, not quite at a direction—more like a memory.</p>
        <p style="color:#ffffff77;">${hint}</p>`,
      choices: [
        { label: "Ask for help (cost: +guilt)", onPick: ()=> ({ effect:"HELP", delta:{ guilt:+10 }, hint:true }) },
        { label: "Back away (cost: +obsession)", onPick: ()=> ({ effect:"BACK", delta:{ obsession:+10 }, hint:false }) },
      ]
    };
  }

  if(a.kind === "SINGER"){
    return {
      title: "A PERSON SINGING TO THE RAIN",
      html: `${lead}
        <p>Their song is not melody. It’s counting. One. Two. You.</p>
        <p><b>“Don’t look at it when it wants you to look.”</b></p>
        <p style="color:#ffffff77;">${hint}</p>`,
      choices: [
        { label: "Listen (Dissonance - a little)", onPick: ()=> ({ effect:"CALM", delta:{}, calm:true }) },
        { label: "Interrupt (Dissonance + a little)", onPick: ()=> ({ effect:"SPIKE", delta:{}, spike:true }) },
      ]
    };
  }

  if(a.kind === "NURSE"){
    return {
      title: "A PERSON WITH DRY HANDS IN THE RAIN",
      html: `${lead}
        <p>They stand too still, like a prop nobody moved.</p>
        <p><b>“You are in second-person because you
