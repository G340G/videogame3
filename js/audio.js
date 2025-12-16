// Procedural audio (rain + drone + tension pulses) with Dissonance modulation
export function makeAudio(){
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  // Simple reverb (generated impulse)
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.2, 2.0);
  const revGain = ctx.createGain();
  revGain.gain.value = 0.30;
  convolver.connect(revGain).connect(master);

  // Dry path
  const dry = ctx.createGain();
  dry.gain.value = 0.90;
  dry.connect(master);

  // Rain noise
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
  const oscA = ctx.createOscillator();
  oscA.type = "sawtooth";
  oscA.frequency.value = 55;

  const oscB = ctx.createOscillator();
  oscB.type = "triangle";
  oscB.frequency.value = 110;

  const droneLP = ctx.createBiquadFilter();
  droneLP.type = "lowpass";
  droneLP.frequency.value = 650;

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.0;

  const trem = ctx.createOscillator();
  trem.frequency.value = 0.9;
  const tremDepth = ctx.createGain();
  tremDepth.gain.value = 0.25;

  trem.connect(tremDepth);
  tremDepth.connect(droneGain.gain);

  oscA.connect(droneLP);
  oscB.connect(droneLP);
  droneLP.connect(droneGain);
  droneGain.connect(dry);
  droneGain.connect(convolver);

  // Tension pulse (heartbeat-ish but synthetic)
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

  // Start nodes (muted until resume)
  rain.start();
  oscA.start();
  oscB.start();
  trem.start();
  pulseOsc.start();

  let started = false;

  function resume(){
    if(ctx.state !== "running") ctx.resume();
    started = true;
    // fade in drone a little
    droneGain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.6);
  }

  function setDissonance(d){ // d: 0..1
    const t = ctx.currentTime;

    // rain gets harsher
    rainGain.gain.setTargetAtTime(0.18 + d*0.18, t, 0.15);
    rainHP.frequency.setTargetAtTime(650 + d*1400, t, 0.2);

    // drone: more detune + more trem
    oscA.detune.setTargetAtTime(-8 + d*45, t, 0.2);
    oscB.detune.setTargetAtTime( 12 + d*60, t, 0.2);
    droneLP.frequency.setTargetAtTime(700 - d*340, t, 0.25);
    trem.frequency.setTargetAtTime(0.8 + d*2.2, t, 0.3);

    // pulse intensity rises
    pulseGain.gain.setTargetAtTime(d*0.14, t, 0.10);
    pulseBP.frequency.setTargetAtTime(120 + d*180, t, 0.15);

    // slight master squeeze
    master.gain.setTargetAtTime(0.85 - d*0.10, t, 0.35);
  }

  function stinger(intensity=0.6){
    // short metallic smear
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
    // leave audio context alive; just mute
    master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.2);
  }

  return {
    ctx,
    resume,
    setDissonance,
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
