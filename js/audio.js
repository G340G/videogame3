// Procedural audio (rain + drone + tension pulses + candle crackle + whispers) with Dissonance modulation
export function makeAudio(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.2, 2.0);
  const revGain = ctx.createGain();
  revGain.gain.value = 0.30;
  convolver.connect(revGain).connect(master);

  const dry = ctx.createGain();
  dry.gain.value = 0.90;
  dry.connect(master);

  // Rain
  const rain = noiseNode(ctx);
  const rainHP = ctx.createBiquadFilter();
  rainHP.type = "highpass";
  rainHP.frequency.value = 700;
  const rainLP = ctx.createBiquadFilter();
  rainLP.type = "lowpass";
  rainLP.frequency.value = 6000;
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0.22;
  rain.connect(rainHP).connect(rainLP).connect(rainGain);
  rainGain.connect(dry);
  rainGain.connect(convolver);

  // Drone
  const oscA = ctx.createOscillator(); oscA.type = "sawtooth"; oscA.frequency.value = 55;
  const oscB = ctx.createOscillator(); oscB.type = "triangle"; oscB.frequency.value = 110;

  const droneLP = ctx.createBiquadFilter();
  droneLP.type = "lowpass";
  droneLP.frequency.value = 650;

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.0;

  const trem = ctx.createOscillator(); trem.frequency.value = 0.9;
  const tremDepth = ctx.createGain(); tremDepth.gain.value = 0.25;
  trem.connect(tremDepth);
  tremDepth.connect(droneGain.gain);

  oscA.connect(droneLP);
  oscB.connect(droneLP);
  droneLP.connect(droneGain);
  droneGain.connect(dry);
  droneGain.connect(convolver);

  // Tension pulse
  const pulseOsc = ctx.createOscillator();
  pulseOsc.type = "square";
  pulseOsc.frequency.value = 40;

  const pulseBP = ctx.createBiquadFilter();
  pulseBP.type = "bandpass";
  pulseBP.frequency.value = 120;
  pulseBP.Q.value = 8;

  const pulseGain = ctx.createGain();
  pulseGain.gain.value = 0.0;

  pulseOsc.connect(pulseBP).connect(pulseGain);
  pulseGain.connect(dry);
  pulseGain.connect(convolver);

  // Candle crackle (only up when near candles / interiors)
  const crackle = noiseNode(ctx);
  const crackBP = ctx.createBiquadFilter();
  crackBP.type = "bandpass";
  crackBP.frequency.value = 2400;
  crackBP.Q.value = 2.2;

  const crackGain = ctx.createGain();
  crackGain.gain.value = 0.0;

  crackle.connect(crackBP).connect(crackGain);
  crackGain.connect(dry);
  crackGain.connect(convolver);

  // Whisper bed (dissonance-driven, very low)
  const whisper = noiseNode(ctx);
  const whLP = ctx.createBiquadFilter();
  whLP.type = "lowpass";
  whLP.frequency.value = 1400;

  const whGain = ctx.createGain();
  whGain.gain.value = 0.0;

  whisper.connect(whLP).connect(whGain);
  whGain.connect(convolver);

  // Start nodes
  rain.start(); oscA.start(); oscB.start(); trem.start();
  pulseOsc.start(); crackle.start(); whisper.start();

  let started = false;

  function resume(){
    if(ctx.state !== "running") ctx.resume();
    started = true;
    droneGain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.6);
  }

  function setDissonance(d){ // 0..1
    const t = ctx.currentTime;
    rainGain.gain.setTargetAtTime(0.18 + d*0.18, t, 0.15);
    rainHP.frequency.setTargetAtTime(650 + d*1400, t, 0.2);

    oscA.detune.setTargetAtTime(-8 + d*55, t, 0.2);
    oscB.detune.setTargetAtTime( 12 + d*70, t, 0.2);
    droneLP.frequency.setTargetAtTime(700 - d*360, t, 0.25);
    trem.frequency.setTargetAtTime(0.8 + d*2.4, t, 0.3);

    pulseGain.gain.setTargetAtTime(d*0.14, t, 0.10);
    pulseBP.frequency.setTargetAtTime(120 + d*200, t, 0.15);

    // Whisper creeps in late
    whGain.gain.setTargetAtTime(Math.max(0, (d-0.55))*0.12, t, 0.3);

    master.gain.setTargetAtTime(0.85 - d*0.10, t, 0.35);
  }

  function setCandlePresence(p){ // 0..1
    const t = ctx.currentTime;
    // add slight random flicker
    const flick = 0.75 + Math.random()*0.5;
    crackGain.gain.setTargetAtTime(p*0.08*flick, t, 0.08);
  }

  function stinger(intensity=0.6){
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(740, now);
    o.frequency.exponentialRampToValueAtTime(160, now+0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15*intensity, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.28);
    o.connect(g).connect(convolver);
    o.start(now);
    o.stop(now+0.32);
  }

  function stopAll(){
    master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.2);
  }

  return {
    ctx,
    resume,
    setDissonance,
    setCandlePresence,
    stinger,
    stopAll,
    get started(){ return started; }
  };
}

function makeImpulse(ctx, seconds=2, decay=2){
  const rate = ctx.sampleRate;
  const len = rate * seconds;
  const buf = ctx.createBuffer(2, len, rate);
  for(let ch=0; ch<2; ch++){
    const data = buf.getChannelData(ch);
    for(let i=0;i<len;i++){
      const t = i/len;
      data[i] = (Math.random()*2-1) * Math.pow(1-t, decay);
    }
  }
  return buf;
}

function noiseNode(ctx){
  const bufferSize = 2*ctx.sampleRate;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
  const node = ctx.createBufferSource();
  node.buffer = noiseBuffer;
  node.loop = true;
  return node;
}

