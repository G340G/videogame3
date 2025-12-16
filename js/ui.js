export function makeUI(){
  const els = {
    fx: document.getElementById("fx"),
    hint: document.getElementById("centerHint"),
    levelPill: document.getElementById("levelPill"),
    relicPill: document.getElementById("relicPill"),
    missionPill: document.getElementById("missionPill"),
    dissonancePill: document.getElementById("dissonancePill"),

    modal: document.getElementById("modal"),
    modalTitle: document.getElementById("modalTitle"),
    modalBody: document.getElementById("modalBody"),
    modalChoices: document.getElementById("modalChoices"),
    closeModal: document.getElementById("closeModal"),

    journal: document.getElementById("journal"),
    journalBody: document.getElementById("journalBody"),
    closeJournal: document.getElementById("closeJournal"),

    death: document.getElementById("death"),
    retry: document.getElementById("retry"),

    ending: document.getElementById("ending"),
    endingBody: document.getElementById("endingBody"),
    restartGame: document.getElementById("restartGame"),
  };

  const fxCtx = els.fx.getContext("2d", { alpha:true });

  function resizeFX(){
    els.fx.width = Math.floor(window.innerWidth);
    els.fx.height = Math.floor(window.innerHeight);
  }
  window.addEventListener("resize", resizeFX);
  resizeFX();

  function setHint(text, show=true){
    els.hint.textContent = text;
    els.hint.classList.toggle("hidden", !show);
  }

  function setTop({level, relics, mission, dissonance}){
    els.levelPill.textContent = `LEVEL ${level}/4`;
    els.relicPill.textContent = `RELICS ${relics}/4`;
    els.missionPill.textContent = mission;
    const d = Math.round(dissonance);
    els.dissonancePill.textContent = `DISSONANCE ${d}%`;
    els.dissonancePill.classList.toggle("bad", d >= 70);
  }

  function openModal({title, html, choices=[]}){
    els.modalTitle.textContent = title || "NOTE";
    els.modalBody.innerHTML = html || "";
    els.modalChoices.innerHTML = "";
    for(const ch of choices){
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = ch.label;
      b.onclick = ch.onPick;
      els.modalChoices.appendChild(b);
    }
    els.modal.classList.remove("hidden");
  }

  function closeModal(){ els.modal.classList.add("hidden"); }

  function openJournal(html){
    els.journalBody.innerHTML = html;
    els.journal.classList.remove("hidden");
  }
  function closeJournal(){ els.journal.classList.add("hidden"); }

  function showDeath(show){ els.death.classList.toggle("hidden", !show); }
  function showEnding(show, html=""){ els.endingBody.innerHTML = html; els.ending.classList.toggle("hidden", !show); }

  function drawFX({dissonance=0, wet=1, t=0, warning=0}){
    const W = els.fx.width, H = els.fx.height;
    fxCtx.clearRect(0,0,W,H);

    // vignette
    fxCtx.globalAlpha = 0.25 + (dissonance/100)*0.35;
    const g = fxCtx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.15, W/2,H/2, Math.max(W,H)*0.65);
    g.addColorStop(0,"rgba(0,0,0,0)");
    g.addColorStop(1,"rgba(0,0,0,1)");
    fxCtx.fillStyle = g;
    fxCtx.fillRect(0,0,W,H);

    // scanline-ish
    fxCtx.globalAlpha = 0.06 + (dissonance/100)*0.10;
    for(let y=0; y<H; y+=3){
      fxCtx.fillStyle = (y%6===0) ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
      fxCtx.fillRect(0,y,W,1);
    }

    // grain
    const n = Math.floor(350 + dissonance*9);
    fxCtx.globalAlpha = 0.06 + wet*0.06 + (dissonance/100)*0.10;
    for(let i=0;i<n;i++){
      const x = (Math.random()*W)|0;
      const y = (Math.random()*H)|0;
      const s = 1 + (Math.random()*2);
      fxCtx.fillStyle = Math.random()<0.5 ? "rgba(240,240,240,0.15)" : "rgba(20,20,20,0.2)";
      fxCtx.fillRect(x,y,s,s);
    }

    // warning pulse when entity is close
    if(warning>0){
      fxCtx.globalAlpha = 0.08*warning;
      fxCtx.fillStyle = "rgba(255,180,140,1)";
      fxCtx.fillRect(0,0,W,H);
    }

    fxCtx.globalAlpha = 1;
  }

  // wire UI buttons
  els.closeModal.onclick = closeModal;
  els.closeJournal.onclick = closeJournal;

  return {
    els,
    setHint,
    setTop,
    openModal,
    closeModal,
    openJournal,
    closeJournal,
    showDeath,
    drawFX,
    showEnding,
  };
}
