import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

/**
 * Builds: tree variants (instanced), crooked houses (enterable interiors), candle props + lights.
 * Returns: { houses, treeInstanced }
 */
export function buildWorldExtras({
  group,
  rng,
  maze,
  cellSize,
  level,
  boundsPad = 14,
}) {
  const W = maze.w * cellSize;
  const H = maze.h * cellSize;

  // ---------- Tree variants (instanced) ----------
  const treeCount = 520 + level * 140;
  const variants = makeTreeVariants();

  const inst = variants.map((v) => ({
    trunk: new THREE.InstancedMesh(v.trunkGeo, v.trunkMat, treeCount),
    crown: new THREE.InstancedMesh(v.crownGeo, v.crownMat, treeCount),
  }));

  const dummy = new THREE.Object3D();

  for (let i = 0; i < treeCount; i++) {
    // scatter: mostly outside maze, sometimes inside/near edges
    let x, z;
    if (rng() < 0.74) {
      const pad = boundsPad + rng() * 16;
      const side = (rng() * 4) | 0;
      if (side === 0) { x = -pad;      z = rng() * (H + pad * 2) - pad; }
      if (side === 1) { x = W + pad;   z = rng() * (H + pad * 2) - pad; }
      if (side === 2) { x = rng() * (W + pad * 2) - pad; z = -pad; }
      if (side === 3) { x = rng() * (W + pad * 2) - pad; z = H + pad; }
    } else {
      x = rng() * W;
      z = rng() * H;
    }

    const which = (rng() * variants.length) | 0;
    const s = 0.85 + rng() * 0.75;
    const tilt = rng() * 0.10 - 0.05;

    // trunk
    dummy.position.set(x, (variants[which].trunkY || 0.7) * s, z);
    dummy.rotation.set(tilt, rng() * Math.PI * 2, tilt);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    inst[which].trunk.setMatrixAt(i, dummy.matrix);

    // crown
    dummy.position.set(x, (variants[which].crownY || 2.0) * s, z);
    dummy.rotation.set(tilt * 0.6, rng() * Math.PI * 2, tilt * 0.6);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    inst[which].crown.setMatrixAt(i, dummy.matrix);
  }

  for (const v of inst) {
    group.add(v.trunk);
    group.add(v.crown);
  }

  // ---------- Crooked houses ----------
  const houses = [];
  const houseCount = 2 + Math.min(3, (level / 2) | 0); // 2..4

  for (let i = 0; i < houseCount; i++) {
    const house = makeCrookedHouse({ rng, id: i, level });

    // Place near the outer forest, not inside the maze grid
    const pad = boundsPad + 6 + rng() * 10;
    const side = (rng() * 4) | 0;
    let x, z;
    if (side === 0) { x = -pad;      z = rng() * (H + pad * 2) - pad; }
    if (side === 1) { x = W + pad;   z = rng() * (H + pad * 2) - pad; }
    if (side === 2) { x = rng() * (W + pad * 2) - pad; z = -pad; }
    if (side === 3) { x = rng() * (W + pad * 2) - pad; z = H + pad; }

    house.group.position.set(x, 0, z);
    house.group.rotation.y = rng() * Math.PI * 2;
    house.group.rotation.z = rng() * 0.08 - 0.04;
    house.group.rotation.x = rng() * 0.04 - 0.02;

    group.add(house.group);

    // Candle outside near the door
    const doorWorld = new THREE.Vector3();
    house.door.getWorldPosition(doorWorld);

    const candleOut = makeCandle({ rng, intensity: 1.0 });
    candleOut.mesh.position.set(doorWorld.x + 0.6, 0.0, doorWorld.z + 0.5);
    group.add(candleOut.mesh);

    const outLight = new THREE.PointLight(0xffd7a6, 0.85, 10, 2.2);
    outLight.position.set(candleOut.mesh.position.x, 1.15, candleOut.mesh.position.z);
    group.add(outLight);

    house.outCandle = candleOut;
    house.outLight = outLight;

    houses.push(house);
  }

  return { houses, treeInstanced: inst };
}

function makeTreeVariants() {
  // A: pine
  const trunkGeoA = new THREE.CylinderGeometry(0.12, 0.18, 1.5, 6);
  const crownGeoA = new THREE.ConeGeometry(0.95, 2.4, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2f2a });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x284537 });

  // B: round canopy
  const trunkGeoB = new THREE.CylinderGeometry(0.10, 0.16, 1.3, 6);
  const crownGeoB = new THREE.IcosahedronGeometry(1.05, 0);
  const crownMatB = new THREE.MeshLambertMaterial({ color: 0x2d563c });

  // C: dead spire
  const trunkGeoC = new THREE.CylinderGeometry(0.08, 0.22, 2.2, 5);
  const crownGeoC = new THREE.ConeGeometry(0.55, 1.3, 6);
  const crownMatC = new THREE.MeshLambertMaterial({ color: 0x1f2b25 });

  return [
    { trunkGeo: trunkGeoA, crownGeo: crownGeoA, trunkMat, crownMat: pineMat,  trunkY: 0.75, crownY: 2.1 },
    { trunkGeo: trunkGeoB, crownGeo: crownGeoB, trunkMat, crownMat: crownMatB, trunkY: 0.65, crownY: 2.0 },
    { trunkGeo: trunkGeoC, crownGeo: crownGeoC, trunkMat, crownMat: crownMatC, trunkY: 1.10, crownY: 2.4 },
  ];
}

function makeCrookedHouse({ rng, id = 0 }) {
  const group = new THREE.Group();

  const w = 3.0 + rng() * 1.2;
  const d = 3.0 + rng() * 1.2;
  const h = 2.6 + rng() * 1.1;

  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3f444c });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = h / 2;
  body.rotation.y = rng() * 0.18 - 0.09;
  body.rotation.z = rng() * 0.08 - 0.04;
  group.add(body);

  const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.75, 1.5 + rng() * 0.7, 4);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2a2f35 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = h + 0.7;
  roof.rotation.y = Math.PI / 4 + (rng() * 0.2 - 0.1);
  roof.rotation.z = rng() * 0.10 - 0.05;
  group.add(roof);

  // Door marker (outside)
  const doorGeo = new THREE.BoxGeometry(0.75, 1.35, 0.08);
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x6d675c });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, 0.78, d / 2 + 0.04);
  door.userData.type = "door";
  door.userData.houseId = id;
  group.add(door);

  // Fake window
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.45, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x0b0d10 })
  );
  win.position.set(-w * 0.2, h * 0.62, d / 2 + 0.03);
  group.add(win);

  // Interior pocket space
  const interior = new THREE.Group();
  interior.visible = false;

  const pocketOffset = 900 + id * 80;
  interior.position.set(pocketOffset, 0, 900 + id * 55);

  const roomGeo = new THREE.BoxGeometry(6.6, 3.0, 6.6);
  const roomMat = new THREE.MeshLambertMaterial({ color: 0x24282f, side: THREE.DoubleSide });
  const room = new THREE.Mesh(roomGeo, roomMat);
  room.position.set(0, 1.5, 0);
  interior.add(room);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6.6, 6.6),
    new THREE.MeshLambertMaterial({ color: 0x30353d })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  interior.add(floor);

  // Interior exit door
  const inDoor = new THREE.Mesh(doorGeo, doorMat);
  inDoor.position.set(0, 0.78, -3.25);
  inDoor.userData.type = "inDoor";
  inDoor.userData.houseId = id;
  interior.add(inDoor);

  // Candles inside
  const candleA = makeCandle({ rng, intensity: 1.0 });
  candleA.mesh.position.set(-1.0, 0.0, 0.5);
  interior.add(candleA.mesh);

  const candleB = makeCandle({ rng, intensity: 1.0 });
  candleB.mesh.position.set(1.2, 0.0, -0.6);
  interior.add(candleB.mesh);

  const inLight = new THREE.PointLight(0xffd7a6, 1.05, 14, 2.0);
  inLight.position.set(0.0, 1.6, 0.0);
  interior.add(inLight);

  // Stylized stain (non-graphic)
  const stain = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 14),
    new THREE.MeshBasicMaterial({ color: 0x4a0b12, transparent: true, opacity: 0.55 })
  );
  stain.rotation.x = -Math.PI / 2;
  stain.position.set(0.8, 0.02, 1.2);
  interior.add(stain);

  return {
    id,
    group,
    door,
    interior,
    inDoor,
    inLight,
    inCandles: [candleA, candleB],
    pocketOffset,
  };
}

function makeCandle({ rng, intensity = 1.0 }) {
  const g = new THREE.Group();

  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10, 0.12, 0.35, 8),
    new THREE.MeshLambertMaterial({ color: 0xd9d0be })
  );
  wax.position.y = 0.18;
  g.add(wax);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.18, 7),
    new THREE.MeshBasicMaterial({ color: 0xffe1b3 })
  );
  flame.position.y = 0.45;
  flame.rotation.x = Math.PI;
  g.add(flame);

  g.userData.candle = true;
  g.userData.flicker = 0.6 + rng() * 0.7;
  g.userData.intensity = intensity;

  return { mesh: g, wax, flame };
}

