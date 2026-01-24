"use strict";


/******************************************************************
 * 1. CONSTANTS & GLOBAL CONFIG
 ******************************************************************/

const G = 6.67430e-11;      // m^3 kg^-1 s^-2
const C = 299792458;       // m/s
const HBAR = 1.054571817e-34;  // J·s

// --- Timing ---
const PHYSICS_FPS = 40;
const PHYSICS_DT = 1 / PHYSICS_FPS;
const THRUST_REPEAT_MS = 50;

// --- Scaling ---
const SCREEN_WIDTH_METERS = 1.49896e8;
const UNIVERSE_DIAMETER_METERS = SCREEN_WIDTH_METERS*60;//8.99377e9;
const UNIVERSE_RADIUS_METERS = UNIVERSE_DIAMETER_METERS / 2;
const GS_INITIAL_SCREEN_RATIO = 0.03;
const STAR_PARALLAX_FACTOR = 0.05;
const GRAVITY_SCALE = 1e27; // tune this to adjust gravitational strength

// --- Gravitational Singularity ---
const M0 = 1.52786e6; // kg
const INITIAL_GS_SPEED = 0.1 * C;
const MAX_SPEED = C;
const INITIAL_HALO_ALPHA = 1;
const HALO_SCALE = 2; // halo diameter multiplier
const INNER_FADE_RADIUS = 1; // start fading at GS radius

const HALO_BEAM_COUNT = 100;
const HALO_BEAM_WIGGLE = 25;
const HALO_BEAM_SEGMENTS = 10;
const HALO_FIRST_SEGMENTS_WIDTH = 8;
const HALO_BEAM_REFRESH_FPS = 5;
const HALO_BEAM_REFRESH_INTERVAL = 1000 / HALO_BEAM_REFRESH_FPS;

// --- Small bodies ---
const TOTAL_SMALL_BODIES_MASS = 500 * M0;
const SMALL_BODY_MIN_MASS = 0.001 * M0;
const SMALL_BODY_MAX_MASS = 0.05 * M0;
const SMALL_BODY_MIN_SPEED = 0.0001 * C;
const SMALL_BODY_MAX_SPEED = 0.001 * C;
const SMALL_BODY_INFLUENCE_RADIUS_MULT = 5;
const SMALL_BODY_DENSITY = 1e-14; // kg/m³

const GROUP_GENERATORS = [
  { name: "disk",    weight: 1, color: 0x00FF00, create: createDiskGroup },
  { name: "spiral",  weight: 1, color: 0xade0ff, create: createSpiralGalaxy },
  { name: "nebula",  weight: 1, color: 0xefc7ff, create: createSphericalNebula },
  { name: "comet",   weight: 1, color: 0xadf7c2, create: createComet },
  { name: "fractal", weight: 1, color: 0xffbb00, create: createFractalCloud },
  { name: "ring",    weight: 1, color: 0xFFFFFF, create: createRing },
  { name: "cross",   weight: 1, color: 0xf5ff6e, create: createCrossXShape }
];

// --- Background ---
const STAR_COUNT = 3000;
const STAR_SIZE_MIN = 1;
const STAR_SIZE_MAX = 4;

// --- Input ---
const DELTA_MASS_EJECTION = M0 * 0.01;

// --- UI ---
const UI_WIDTH = 300;
const UI_HEIGHT = 110;


const SMALL_BODY_COLORS = [
  0x8B4513, // brown
  0xFF0000, // red
  0xFF7F00, // orange
  0xFFFF00, // yellow
  0x00FF00, // green
  0x0000FF, // blue
  0xADD8E6, // blue-white (light blue)
  0xFFFFFF  // white
];

/******************************************************************
 * 2. GLOBAL STATE
 ******************************************************************/

let app;
let physicsAccumulator = 0;
let universeBorder;
let starsContainer;
let starsGraphics;

let thrustIntervalId = null;
let thrustDx = 0;
let thrustDy = 0;

let gameState = {
  time: 0,

  nextBodyId: 1,

  gs: [],
  smallBodies: [],
  stars: []
};

         
let ui = {};


/******************************************************************
 * 3. ENTRY POINT
 ******************************************************************/

(async function main() {
  await initPixi();
  initGame();
  initInput();
  startGameLoop();
})();


/******************************************************************
 * 4. PIXI INITIALIZATION
 ******************************************************************/

async function initPixi() {
  app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x000000,
    antialias: true
  });
  document.body.appendChild(app.canvas);
}


/******************************************************************
 * 5. GAME INITIALIZATION
 ******************************************************************/

function initGame() {
  createStars();
  createGS();
  createInitialSmallBodies();
  createUI();
  createUniverseBorder();
}


/******************************************************************
 * 6. INPUT
 ******************************************************************/

function initInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  window.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mouseup", stopThrust);

  window.addEventListener("touchstart", onPointerDown, { passive: true });
  window.addEventListener("touchend", stopThrust);
}

function onKeyDown(e) {
  if (thrustIntervalId !== null) return; // already thrusting

  let dx = 0, dy = 0;

  if (e.key === "ArrowLeft") dx = -1;
  if (e.key === "ArrowRight") dx = 1;
  if (e.key === "ArrowUp") dy = -1;
  if (e.key === "ArrowDown") dy = 1;

  if (dx || dy) startThrust(dx, dy);
}

function onKeyUp(e) {
  if (
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "ArrowUp" ||
    e.key === "ArrowDown"
  ) {
    stopThrust();
  }
}

function onPointerDown(e) {
  let x, y;

  if (e.touches && e.touches.length > 0) {
    x = e.touches[0].clientX;
    y = e.touches[0].clientY;
  } else {
    x = e.clientX;
    y = e.clientY;
  }

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  const dxp = x - cx;
  const dyp = y - cy;

  let dx = 0, dy = 0;

  if (Math.abs(dxp) > Math.abs(dyp)) {
    dx = dxp > 0 ? 1 : -1;
  } else {
    dy = dyp > 0 ? 1 : -1;
  }

  startThrust(dx, dy);
}

function startThrust(dx, dy) {
  stopThrust(); // safety

  thrustDx = dx;
  thrustDy = dy;

  // Fire immediately
  applyMomentumThrust(dx, dy);

  // Repeat while held
  thrustIntervalId = setInterval(() => {
    applyMomentumThrust(thrustDx, thrustDy);
  }, THRUST_REPEAT_MS);
}

function stopThrust() {
  if (thrustIntervalId !== null) {
    clearInterval(thrustIntervalId);
    thrustIntervalId = null;
  }
}


/*function initInput() {
  window.addEventListener("keydown", onKeyDown);
}

function onKeyDown(e) {
  let dx = 0, dy = 0;

  if (e.key === "ArrowLeft") dx = -1;
  if (e.key === "ArrowRight") dx = 1;
  if (e.key === "ArrowUp") dy = -1;
  if (e.key === "ArrowDown") dy = 1;

  if (dx || dy) applyMomentumThrust(dx, dy);
}*/


/******************************************************************
 * 7. GAME LOOP
 ******************************************************************/

function startGameLoop() {
  //let lastTime = performance.now();

  app.ticker.add(() => {
    /*const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;*/
    
    const dt = app.ticker.elapsedMS / 1000;

    physicsAccumulator += dt;
    while (physicsAccumulator >= PHYSICS_DT) {
      updatePhysics(PHYSICS_DT);
      physicsAccumulator -= PHYSICS_DT;
    }

    render();
  });
}


/******************************************************************
 * 8. SMALL BODY CREATION
 ******************************************************************/

function createGS() {
  const gs = {
    id: gameState.nextBodyId++,
    mass: M0,
    radiusRatio: GS_INITIAL_SCREEN_RATIO,
    x:0,
    y: 0,
    vx: INITIAL_GS_SPEED,
    vy: 0,
    sprite: new PIXI.Graphics(),
    halo: new PIXI.Graphics(),
    haloLastUpdateTime: 0,
    lightningHalo: new PIXI.Graphics() 
  };
  gs.lightningHalo.filters = [new PIXI.BlurFilter({ strength: 8, quality: 4 })];
  gameState.gs.push(gs);
  
  app.stage.addChild(gs.halo);
  app.stage.addChild(gs.sprite);
  app.stage.addChild(gs.lightningHalo);
}


function createStars() {
  starsContainer = new PIXI.Container();
  starsGraphics = new PIXI.Graphics();

  starsContainer.addChild(starsGraphics);
  app.stage.addChild(starsContainer);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = UNIVERSE_RADIUS_METERS * Math.sqrt(Math.random());
    let starObj = {
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      radius: randomRange(STAR_SIZE_MIN, STAR_SIZE_MAX)
    };

    gameState.stars.push(starObj);
    const xPx = metersToPixels(starObj.x * STAR_PARALLAX_FACTOR);
    const yPx = metersToPixels(starObj.y * STAR_PARALLAX_FACTOR);

    starsGraphics.circle(xPx, yPx, starObj.radius).fill(0xFFFFFF);
  }

}

/*function createStars() {
  starsGraphics = new PIXI.Graphics();
  app.stage.addChild(starsGraphics);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = UNIVERSE_RADIUS_METERS * Math.sqrt(Math.random());

    gameState.stars.push({
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      radius: randomRange(STAR_SIZE_MIN, STAR_SIZE_MAX)
    });
  }
}*/

/*function createStars() {
  for (let i = 0; i < STAR_COUNT; i++) {
    const starSprite = new PIXI.Graphics();
    const radiusPx = randomRange(STAR_SIZE_MIN, STAR_SIZE_MAX);
    starSprite.circle(0, 0, radiusPx).fill(0xffffff);

    // Uniform random position inside universe circle (physical meters)
    const theta = Math.random() * Math.PI * 2;
    //const r = UNIVERSE_RADIUS_METERS * Math.sqrt(Math.random());
    const r = UNIVERSE_RADIUS_METERS * Math.random();

    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
  
    const star = {
      x: x,
      y: y,
      radius: radiusPx,
      sprite: new PIXI.Graphics()
    };

    gameState.stars.push(star);
    app.stage.addChild(star.sprite);
  }
}*/

function createUI() {
  ui.container = new PIXI.Container();

  ui.bg = new PIXI.Graphics();
  ui.bg.rect(0, 0, UI_WIDTH, UI_HEIGHT).fill({ color: 0x000000, alpha: 0.5 });

  ui.text = new PIXI.Text({
    text: "",
    style: {
      fill: 0xcccccc,
      fontSize: 14
    }
  });

  ui.text.x = 10;
  ui.text.y = 10;

  ui.container.addChild(ui.bg);
  ui.container.addChild(ui.text);
  app.stage.addChild(ui.container);
}

function createUniverseBorder() {
  universeBorder = new PIXI.Graphics();
  app.stage.addChild(universeBorder);
}

function createInitialSmallBodies() {
  let totalMass = 0;
  
  // Create specific small bodygroup close to GS
  const gen = GROUP_GENERATORS[3];
  const params = makeRandomGroupParams();
  const gs = gameState.gs[0];
  params.N = 200;
  params.centerX = gs.x - SCREEN_WIDTH_METERS*0.5;
  params.centerY = gs.y - SCREEN_WIDTH_METERS*0.1;
  params.vx = INITIAL_GS_SPEED*1.9;
  params.vy = -INITIAL_GS_SPEED*0.02;
  params.radius = SCREEN_WIDTH_METERS*0.1;
  params.color = gen.color;
  //params.color = 0xade0ff;
  //params.armTightness = 2;
  const specialGroup = gen.create(params);
  
  for (const obj of specialGroup) {
    gameState.smallBodies.push(obj);
    app.stage.addChild(obj.sprite);
  }

  totalMass = gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0);

  while (totalMass < TOTAL_SMALL_BODIES_MASS) {
    const group = createRandomSmallBodiesGroup();
      
    for (const obj of group) {
      gameState.smallBodies.push(obj);
      app.stage.addChild(obj.sprite);
    }
    totalMass = gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0);
  }
  
  
/*  for (let i = 0; i < 150; i++) {
    const group = createRandomSmallBodiesGroup();
  
    for (const obj of group) {
      gameState.smallBodies.push(obj);
      app.stage.addChild(obj.sprite);
    }
  }*/


  /*while (totalMass < TOTAL_SMALL_BODIES_MASS) {
    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);
    totalMass += mass;

    const obj = createSmallBody(mass);
    gameState.smallBodies.push(obj);
    app.stage.addChild(obj.sprite);
  }*/
}

function createSmallBody(mass) {
  const angle = Math.random() * Math.PI * 2;
  const speed = randomRange(SMALL_BODY_MIN_SPEED, SMALL_BODY_MAX_SPEED);

  // Uniform random position inside universe circle
  const theta = Math.random() * Math.PI * 2;
  const r = UNIVERSE_RADIUS_METERS * Math.sqrt(Math.random());

  const x = Math.cos(theta) * r;
  const y = Math.sin(theta) * r;

  return {
    id: gameState.nextBodyId++,
    mass: mass,
    x: x,
    y: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    
    sprite: new PIXI.Graphics(),
    color: getColorByMass(mass)
  };
}

function createSmallBodiesIfNeeded() {
  const TOLERANCE = 0.95; // allow 5% deficit

  // Calculate current total mass
  let totalMass = gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0);

  // If within tolerance, do nothing
  if (totalMass >= TOTAL_SMALL_BODIES_MASS * TOLERANCE) {
    return;
  }

  while (totalMass < TOTAL_SMALL_BODIES_MASS) {
    const group = createRandomSmallBodiesGroup();
      
    for (const obj of group) {
      gameState.smallBodies.push(obj);
      app.stage.addChild(obj.sprite);
    }
    totalMass = gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0);
  }

  // Create bodies until target mass is reached
  /*while (currentMass < TOTAL_SMALL_BODIES_MASS) {
    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

    let newObj = createSmallBody(mass);

    gameState.smallBodies.push(newObj);
    currentMass += mass;
  }*/
}

function makeRandomGroupParams() {
  return {
    // common
    N: Math.floor(randomRange(20, 50)),
    centerX: randomRange(-UNIVERSE_RADIUS_METERS, UNIVERSE_RADIUS_METERS),
    centerY: randomRange(-UNIVERSE_RADIUS_METERS, UNIVERSE_RADIUS_METERS),
    radius: randomRange(SCREEN_WIDTH_METERS * 0.2, SCREEN_WIDTH_METERS * 0.7),
    vx: randomRange(-SMALL_BODY_MAX_SPEED, SMALL_BODY_MAX_SPEED),
    vy: randomRange(-SMALL_BODY_MAX_SPEED, SMALL_BODY_MAX_SPEED),

    // spiral galaxy
    armCount: Math.random() < 0.5 ? 2 : 4,
    armTightness: randomRange(1.5, 3),

    // nebula
    densityBias: randomRange(0.7, 2.0),

    // ring
    ringWidthFactor: randomRange(0.08, 0.2),

    // comet
    cometSpeedFactor: randomRange(1.5, 2.5)
  };
}


function createRandomSmallBodiesGroup() {
  const gen = pickRandomGenerator(GROUP_GENERATORS);
  const params = makeRandomGroupParams();
  params.color = gen.color;
  return gen.create(params);
}


function pickRandomGenerator(generators) {
  const totalWeight = generators.reduce((s, g) => s + g.weight, 0);
  let r = randomRange(0, totalWeight);

  for (const g of generators) {
    r -= g.weight;
    if (r <= 0) return g;
  }

  return generators[generators.length - 1];
}


// Different Shape Generators (e.g., spiral galaxy, nebule, rings, etc.)
function createDiskGroup({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];

  for (let i = 0; i < N; i++) {
    const r = radius * Math.sqrt(Math.random());
    const theta = Math.random() * Math.PI * 2;

    const x = centerX + Math.cos(theta) * r;
    const y = centerY + Math.sin(theta) * r;

    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}


function createSpiralGalaxy({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color,
  armCount,
  armTightness
}) {
  const bodies = [];

  const coreFraction = 0.3;               // 30% of bodies in core
  const coreRadius = radius * 0.2;        // compact bulge
  const coreCount = Math.floor(N * coreFraction);
  const armCountBodies = N - coreCount;

  // --- CORE (dense, isotropic) ---
  for (let i = 0; i < coreCount; i++) {
    const r = coreRadius * Math.sqrt(Math.random());
    const theta = Math.random() * Math.PI * 2;

    const x = centerX + Math.cos(theta) * r;
    const y = centerY + Math.sin(theta) * r;

    const mass = randomRange(
      SMALL_BODY_MIN_MASS,
      SMALL_BODY_MIN_MASS + (SMALL_BODY_MAX_MASS - SMALL_BODY_MIN_MASS) * 0.1
    );

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  // --- SPIRAL ARMS ---
  for (let i = 0; i < armCountBodies; i++) {
    const r = randomRange(coreRadius, radius);
    const arm = Math.floor(Math.random() * armCount);
    const baseAngle = (arm / armCount) * Math.PI * 2;

    const theta =
      baseAngle +
      armTightness * Math.log(r / radius + 1e-6) +
      (Math.random() - 0.5) * 0.15; // arm thickness

    const x = centerX + Math.cos(theta) * r;
    const y = centerY + Math.sin(theta) * r;

    const mass = randomRange(
      SMALL_BODY_MIN_MASS,
      SMALL_BODY_MIN_MASS + (SMALL_BODY_MAX_MASS - SMALL_BODY_MIN_MASS) * 0.1
    );

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}


function createSphericalNebula({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color,
  densityBias = 1
}) {
  const bodies = [];

  for (let i = 0; i < N; i++) {
    const r = radius * Math.pow(Math.random(), 1 / densityBias);
    const theta = Math.random() * Math.PI * 2;

    const x = centerX + Math.cos(theta) * r;
    const y = centerY + Math.sin(theta) * r;

    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}

function createComet({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];

  const dir = Math.atan2(vy, vx);
  const tailDir = dir + Math.PI;

  // --- 1. Create nucleus / coma ---
  const nucleusCount = Math.floor(N * 0.15);
  for (let i = 0; i < nucleusCount; i++) {
    const r = radius * 0.15 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;

    const x = centerX + Math.cos(a) * r;
    const y = centerY + Math.sin(a) * r;

    const mass = randomRange(
      SMALL_BODY_MIN_MASS,
      SMALL_BODY_MAX_MASS
    );

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  // --- 2. Create tail ---
  const tailCount = N - nucleusCount;

  for (let i = 0; i < tailCount; i++) {
    const t = Math.random();            // 0 (head) → 1 (tail end)

    // Quadratic falloff → soft edge
    const dist = radius * (0.2 + t * t);

    // Tail widens with distance
    const spread = 0.05 + t * 0.6;

    const angle =
      tailDir +
      (Math.random() - 0.5) * spread;

    // Slight lateral noise to break symmetry
    const jitter = radius * 0.05 * (Math.random() - 0.5);

    const x =
      centerX +
      Math.cos(angle) * dist +
      Math.cos(angle + Math.PI / 2) * jitter;

    const y =
      centerY +
      Math.sin(angle) * dist +
      Math.sin(angle + Math.PI / 2) * jitter;

    const mass = randomRange(
      SMALL_BODY_MIN_MASS,
      SMALL_BODY_MIN_MASS
    );

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}


/*
function createComet({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];

  const dir = Math.atan2(vy, vx);
  const tailDir = dir + Math.PI;

  for (let i = 0; i < N; i++) {
    const t = Math.random();
    const r = radius * (1 - t * 0.8);

    const angle =
      tailDir +
      (Math.random() - 0.5) * Math.PI * 0.3;

    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;

    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MIN_MASS);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}*/


function createFractalCloud({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];
  const clusters = 4;

  for (let c = 0; c < clusters; c++) {
    const cx = centerX + randomRange(-radius, radius);
    const cy = centerY + randomRange(-radius, radius);

    const count = Math.floor(N / clusters);

    for (let i = 0; i < count; i++) {
      const r = radius * 0.3 * Math.sqrt(Math.random());
      const theta = Math.random() * Math.PI * 2;

      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;

      const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

      bodies.push({
        id: gameState.nextBodyId++,
        mass,
        x,
        y,
        vx,
        vy,
        sprite: new PIXI.Graphics(),
        color: color || getColorByMass(mass)
      });
    }
  }

  return bodies;
}


function createRing({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];
  const width = radius * 0.15;

  for (let i = 0; i < N; i++) {
    const r = radius + randomRange(-width, width);
    const theta = Math.random() * Math.PI * 2;

    const x = centerX + Math.cos(theta) * r;
    const y = centerY + Math.sin(theta) * r;

    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: getColorByMass(mass)
    });
  }

  return bodies;
}

function createCrossXShape({
  N,
  centerX,
  centerY,
  radius,
  vx,
  vy,
  color
}) {
  const bodies = [];

  for (let i = 0; i < N; i++) {
    const t = randomRange(-radius, radius);
    const diagonal = Math.random() < 0.5 ? 1 : -1;

    const x = centerX + t;
    const y = centerY + diagonal * t;

    const mass = randomRange(SMALL_BODY_MIN_MASS, SMALL_BODY_MAX_MASS);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: new PIXI.Graphics(),
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}

/******************************************************************
 * 9. PHYSICS UPDATE
 ******************************************************************/

function updatePhysics(dt) {
  gameState.time += dt;

  updateGSState(dt);
  updateSmallBodies(dt);
  //createSmallBodiesIfNeeded();
}

function updateGSState(dt) {
  const gs = gameState.gs[0];

  // --- Mass evolution ---
  gs.mass += hawkingMassLoss(gs.mass, dt);
  if (gs.mass <= 0) {
    gs.mass = 0;
    gameOver();
    return;
  }

  // --- Motion ---
  gs.x += gs.vx * dt;
  gs.y += gs.vy * dt;

  wrapUniversePosition(gs);

  // --- Visual proxy ---
  gs.radiusRatio = GS_INITIAL_SCREEN_RATIO * (gs.mass / M0);
}

function updateSmallBodies(dt) {
  // For now we use the first GS; future versions may loop over multiple GS
  const gs = gameState.gs[0];
  if (!gs) return;

  const gsX = gs.x;
  const gsY = gs.y;

  // GS physical radius (in meters)
  const gsRadiusMeters = gs.radiusRatio * SCREEN_WIDTH_METERS;

  // Radius within which GS gravity affects small bodies (physical meters)
  const influenceRadius = gsRadiusMeters * SMALL_BODY_INFLUENCE_RADIUS_MULT;

  // Iterate backwards so we can safely remove absorbed bodies
  for (let i = gameState.smallBodies.length - 1; i >= 0; i--) {
    const obj = gameState.smallBodies[i];

    const dx = obj.x - gsX;
    const dy = obj.y - gsY;
    const distanceToGS = Math.hypot(dx, dy);
    
    const smallBodyRadiusMeters = smallBodyMassToRadiusMeters(obj.mass);

    // Apply gravity only inside influence radius
    if (distanceToGS < influenceRadius) {
      applyPWGravity(obj, dx, dy, distanceToGS, dt);
    } else {
      // Move with constant velocity
      obj.x += obj.vx * dt;
      obj.y += obj.vy * dt;
    }

    // Absorption by GS
    if (distanceToGS < (gsRadiusMeters + smallBodyRadiusMeters)) {
      //increase GS mass by the mass of absorbed small body
      gs.mass += obj.mass;
      obj.sprite.clear();
      //remove small body
      gameState.smallBodies.splice(i, 1);
    }
    wrapUniversePosition(obj);
  }
}


/******************************************************************
 * 10. MOMENTUM / INPUT PHYSICS
 ******************************************************************/

function applyMomentumThrust(dx, dy) {
  const gs = gameState.gs[0];
  if (!gs) return;

  if (dx === 0 && dy === 0) return;

  if (gs.mass <= DELTA_MASS_EJECTION) return;

  // Mass loss
  gs.mass -= DELTA_MASS_EJECTION;

  // Radiation momentum: p = Δm * c
  const recoilMomentum = DELTA_MASS_EJECTION * C;

  // Project current GS velocity onto thrust direction
  const vParallel = gs.vx * dx + gs.vy * dy;

  // Effective recoil velocity
  const u = recoilMomentum / gs.mass;

  // Relativistic velocity addition along thrust axis
  const vParallelNew =
    (vParallel + u) / (1 + (vParallel * u) / (C * C));

  const dv = vParallelNew - vParallel;

  // Apply velocity change
  gs.vx += dx * dv;
  gs.vy += dy * dv;
}



/******************************************************************
 * 11. RENDERING
 ******************************************************************/

function render() {
  renderStars();
  //render small bodies first so GS is on top and in case of physics/rendering timing mistmatch it does not look like small body is not absorbed by GS.
  renderSmallBodies();
  renderGS();
  renderUI();
  renderUniverseBorder();
}


function renderSmallBodies() {
  const gs = gameState.gs[0];

  const halfW = SCREEN_WIDTH_METERS * 0.5;
  const halfH = halfW * (app.screen.height / app.screen.width);
  const padding = halfW * 0.05;

  const minX = gs.x - halfW - padding;
  const maxX = gs.x + halfW + padding;
  const minY = gs.y - halfH - padding;
  const maxY = gs.y + halfH + padding;

  for (const obj of gameState.smallBodies) {
    const visible =
      obj.x >= minX && obj.x <= maxX &&
      obj.y >= minY && obj.y <= maxY;

    if (visible) {
      const screenPos = worldToScreen(obj.x, obj.y);
      const radiusPx = metersToPixels(
        smallBodyMassToRadiusMeters(obj.mass)
      );

      obj.sprite.clear();
      obj.sprite.circle(screenPos.x, screenPos.y, radiusPx).fill(obj.color);
    }
  }
}

/*function renderSmallBodies() {
  for (const obj of gameState.smallBodies) {
    const screenPos = worldToScreen(obj.x, obj.y);
    const radiusPx = metersToPixels(smallBodyMassToRadiusMeters(obj.mass));

    obj.sprite.clear();
    obj.sprite.circle(screenPos.x, screenPos.y, radiusPx).fill(obj.color);
  }
}*/


function renderStars() {
  const gs = gameState.gs[0];

  starsContainer.x =
    app.screen.width * 0.5 - metersToPixels(gs.x * STAR_PARALLAX_FACTOR);

  starsContainer.y =
    app.screen.height * 0.5 - metersToPixels(gs.y * STAR_PARALLAX_FACTOR);
}

/*function renderStars() {
  starsGraphics.clear();

  const gs = gameState.gs[0];

  const halfW = (SCREEN_WIDTH_METERS * 0.5) / STAR_PARALLAX_FACTOR;
  const halfH = halfW * (app.screen.height / app.screen.width);
  const padding = halfW * 0.05;

  const minX = gs.x - halfW - padding;
  const maxX = gs.x + halfW + padding;
  const minY = gs.y - halfH - padding;
  const maxY = gs.y + halfH + padding;

  for (const star of gameState.stars) {
    const visible =
      star.x >= minX && star.x <= maxX &&
      star.y >= minY && star.y <= maxY;

    if (visible) {
      const screenPos = worldToScreen(
        star.x,
        star.y,
        STAR_PARALLAX_FACTOR
      );

      starsGraphics
        .circle(screenPos.x, screenPos.y, star.radius)
        .fill(0xFFFFFF);
    }
  }
}*/


/*function renderStars() {
  starsGraphics.clear();

  for (const star of gameState.stars) {
    const screenPos = worldToScreen(star.x, star.y, STAR_PARALLAX_FACTOR);

    starsGraphics
      .circle(screenPos.x, screenPos.y, star.radius)
      .fill(0xFFFFFF);
  }
}*/

/*function renderStars() {
  for (const star of gameState.stars) {
    const screenPos = worldToScreen(star.x, star.y, STAR_PARALLAX_FACTOR);

    star.sprite.x = screenPos.x;
    star.sprite.y = screenPos.y;
    
    star.sprite.clear();
    star.sprite.circle(screenPos.x, screenPos.y, star.radius).fill(0xFFFFFF);
  }
}*/


function renderGS() {
  const gs = gameState.gs[0];
  //renderHalo(gs);
  renderLightningHalo(gs);
  //drawLightning(100, 100, 500, 300, 10, 30, 0x00FF00);
  const screenPos = worldToScreen(gs.x, gs.y);
  const radiusPx = gs.radiusRatio * app.screen.width;

  gs.sprite.clear();
  gs.sprite.circle(screenPos.x, screenPos.y, radiusPx).fill(0x000000);
}

function renderLightningHalo(gs) {
  
  const now = performance.now();

  if (now - gs.haloLastUpdateTime < HALO_BEAM_REFRESH_INTERVAL) {
    return;
  }

  gs.haloLastUpdateTime = now;
  
  const screenPos = worldToScreen(gs.x, gs.y);
  const gsRadiusPx = gs.radiusRatio * app.screen.width;
  const outerRadiusPx = gsRadiusPx * HALO_SCALE;

  const color = getHaloColor(gs.mass);

  // Reuse graphics object
  /*if (!gs.lightningHalo) {
    gs.lightningHalo = new PIXI.Graphics();

    const blur = new PIXI.BlurFilter({ strength: 6, quality: 4 });
    gs.lightningHalo.filters = [blur];

    app.stage.addChild(gs.lightningHalo);
  }*/

  const g = gs.lightningHalo;
  g.clear();

  for (let i = 0; i < HALO_BEAM_COUNT; i++) {
    const angle = (i / HALO_BEAM_COUNT) * Math.PI * 2;

    // Slight angular jitter per beam
    const jitter = (Math.random() - 0.5) * 0.15;
    const a = angle + jitter;

    const startX = screenPos.x + Math.cos(a) * gsRadiusPx;
    const startY = screenPos.y + Math.sin(a) * gsRadiusPx;

    const endX = screenPos.x + Math.cos(a) * outerRadiusPx;
    const endY = screenPos.y + Math.sin(a) * outerRadiusPx;

    drawLightningSegment(
      g,
      startX,
      startY,
      endX,
      endY,
      HALO_BEAM_SEGMENTS,
      HALO_BEAM_WIGGLE,
      color
    );
  }
}



function drawLightningSegment(
  g,
  startX,
  startY,
  endX,
  endY,
  segments,
  maxWiggle,
  color
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);

  const sideX = -Math.sin(angle);
  const sideY = Math.cos(angle);

  g.moveTo(startX, startY);
  
  let prevX = startX;
  let prevY = startY;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;

    let px = startX + dx * t;
    let py = startY + dy * t;

    if (i < segments) {
      const wiggle = (Math.random() - 0.5) * maxWiggle;
      px += sideX * wiggle;
      py += sideY * wiggle;
    }
    
    let segmentWidth = HALO_FIRST_SEGMENTS_WIDTH * (1 - t * 0.9);
    let segmentAlpha = INITIAL_HALO_ALPHA * (1 - t);
    /*g.stroke({
      width: 8 * (1 - t * 0.9),
      color,
      alpha: INITIAL_HALO_ALPHA * (1 - t),
      cap: 'round',
      join: 'round',
    });

    g.moveTo(prevX, prevY);
    g.lineTo(px, py);*/
    
    drawThickLine(g, prevX, prevY, px, py, segmentWidth, color, segmentAlpha);

    prevX = px;
    prevY = py;
  }
}

function drawThickLine(g, x0, y0, x1, y1, width, color, alpha = 1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx*dx + dy*dy);

  // unit perpendicular
  const px = -dy / len * width/2;
  const py = dx / len * width/2;

  g.beginFill(color, alpha);

  g.moveTo(x0 + px, y0 + py);
  g.lineTo(x0 - px, y0 - py);
  g.lineTo(x1 - px, y1 - py);
  g.lineTo(x1 + px, y1 + py);
  g.closePath();

  g.endFill();
}


/*function drawLightningSegment(
  g,
  startX,
  startY,
  endX,
  endY,
  segments,
  maxWiggle,
  color
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);

  const sideX = -Math.sin(angle);
  const sideY = Math.cos(angle);

  g.moveTo(startX, startY);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    let px = startX + dx * t;
    let py = startY + dy * t;

    if (i < segments) {
      const wiggle = (Math.random() - 0.5) * maxWiggle;
      px += sideX * wiggle;
      py += sideY * wiggle;
    }

    g.stroke({
      width: 6 * (1 - t),
      color,
      alpha: INITIAL_HALO_ALPHA * (1 - t),
    });

    g.lineTo(px, py);
  }
}*/



/*function renderHalo(gs) {
  const screenPos = worldToScreen(gs.x, gs.y);
  const gsRadiusPx = gs.radiusRatio * app.screen.width;
  const outerRadiusPx = gsRadiusPx * HALO_SCALE;

  gs.halo.clear();

  const haloColor = getHaloColor(gs.mass);

  const steps = 50; // smoothness
  const time = gameState.time;

  for (let i = 0; i < steps; i++) {
    const t = i / steps; // 0 = inner, 1 = outer

    // Base radius
    let r = gsRadiusPx + t * (outerRadiusPx - gsRadiusPx);

    // Add distortion: small sine offset
    const offset = Math.sin(time * 2 + i * 0.3) * (outerRadiusPx - gsRadiusPx) * 0.03;
    r += offset;

    // Alpha fade remains linear
    const alpha = INITIAL_HALO_ALPHA * (1 - t);

    gs.halo.beginFill(haloColor, alpha);
    gs.halo.drawCircle(screenPos.x, screenPos.y, r);
    gs.halo.endFill();
  }
}*/


/*function renderStaticHalo(gs) {
  const screenPos = worldToScreen(gs.x, gs.y);
  const gsRadiusPx = gs.radiusRatio * app.screen.width;
  const outerRadiusPx = gsRadiusPx * HALO_SCALE;

  gs.halo.clear();

  const haloColor = getHaloColor(gs.mass);

  const steps = 50; // smoothness
  for (let i = 0; i < steps; i++) {
    const t = i / steps; // 0 = inner, 1 = outer
    const r = gsRadiusPx + t * (outerRadiusPx - gsRadiusPx); // starts from GS radius
    const alpha = INITIAL_HALO_ALPHA * (1 - t); // fade out from center

    gs.halo.beginFill(haloColor, alpha);
    gs.halo.drawCircle(screenPos.x, screenPos.y, r);
    gs.halo.endFill();
  }
}*/


function getHaloColor(mass) {
  const m = mass / M0;

  // Define anchor points (mass ratio → color)
  const stops = [
    { m: 0.05, color: 0xFFFFFF },
    { m: 0.25, color: 0xa4daf5 },
    { m: 1,    color: 0x68c4f2 },
    { m: 3,    color: 0xff8400 },
    { m: 5,    color: 0xFF0000 },
    { m: 8,    color: 0x996c02 },
    { m: 12,    color: 0x000000 }
  ];

  // Clamp mass to min/max
  const clampedM = Math.max(0.05, Math.min(m, 10));

  // Find which segment the mass falls into
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clampedM >= stops[i].m && clampedM <= stops[i + 1].m) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  // Fraction between lower and upper
  const t = (clampedM - lower.m) / (upper.m - lower.m);

  // Extract RGB channels
  const r1 = (lower.color >> 16) & 0xFF;
  const g1 = (lower.color >> 8) & 0xFF;
  const b1 = lower.color & 0xFF;

  const r2 = (upper.color >> 16) & 0xFF;
  const g2 = (upper.color >> 8) & 0xFF;
  const b2 = upper.color & 0xFF;

  // Linear interpolation
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return (r << 16) | (g << 8) | b;
}

/*let lightning = new PIXI.Graphics();
function drawLightning(startX, startY, endX, endY, segments = 10, maxWiggle = 30, color = 0xffffff) {
  //const lightning = new PIXI.Graphics();
  lightning.clear();
  
  // Create the Blur Filter
  // strength: higher number means more blur
  // quality: higher number means smoother blur
  const blur = new PIXI.BlurFilter({ strength: 5, quality: 5 });
  lightning.filters = [blur];
  
  // Adding padding prevents the blur from being cut off at the edges

  app.stage.addChild(lightning);

  //const startX = 100, startY = 100;
  //const endX = 200, endY = 200;
  //const segments = 10;
  //const maxWiggle = 30;

  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);

  const sideX = -Math.sin(angle);
  const sideY = Math.cos(angle);

  lightning.moveTo(startX, startY);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    let px = startX + dx * t;
    let py = startY + dy * t;

    if (i < segments) {
      const wiggle = (Math.random() - 0.5) * maxWiggle;
      px += sideX * wiggle;
      py += sideY * wiggle;
    }

    lightning.stroke({ width: 8 * (1 - t * 0.9), color: color });
    lightning.lineTo(px, py);
  }
}*/

function renderUI() {
  const gs = gameState.gs[0];
  ui.container.x = app.screen.width - UI_WIDTH - 10;
  ui.container.y = 10;

  const speed = Math.hypot(gs.vx, gs.vy);
  const lifetime = estimateLifetime(gs.mass);

  ui.text.text =
`Mass: ${(gs.mass / 1e6).toFixed(2)} kton
Speed: ${speed.toFixed(1)} m/s (${(speed / C).toFixed(3)}c)
Remaining Lifetime: ${formatTime(lifetime)}
Total SB M: ${((gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0)) / 1e6).toFixed(2)} kton`;
}

function renderUniverseBorder() {
  const gs = gameState.gs[0];

  // Universe center (world 0,0) → screen space
  const center = worldToScreen(0, 0);

  // Universe radius in pixels
  const radiusPx = metersToPixels(UNIVERSE_RADIUS_METERS);

  universeBorder.clear();
  universeBorder
    .circle(center.x, center.y, radiusPx)
    .stroke({
      width: 2,
      color: 0xff0000,
      alpha: 1
    });
}



/******************************************************************
 * 12. PHYSICS HELPERS
 ******************************************************************/

function applyPWGravity(obj, dx, dy, r, dt) {
  const gs = gameState.gs[0];
  // Schwarzschild radius (meters)

  const rs = (2 * G * gs.mass) / (C * C);

  // Avoid singularity blow-up
  const epsilon = 0.01 * rs;
  if (r <= rs + epsilon) return;

  // Unit radial vector
  const invR = 1 / r;
  const ux = dx * invR;
  const uy = dy * invR;

  // Paczyński–Wiita acceleration magnitude
  const a = GRAVITY_SCALE * (G * gs.mass) / ((r - rs) * (r - rs));

  // Acceleration vector (toward GS)
  const ax = -a * ux;
  const ay = -a * uy;

  // Semi-implicit Euler (symplectic)
  obj.vx += ax * dt;
  obj.vy += ay * dt;

  obj.x += obj.vx * dt;
  obj.y += obj.vy * dt;
}

function hawkingMassLoss(mass, dt) {
  // Hawking evaporation for Schwarzschild black hole
  // Returns mass loss ΔM (kg) over time dt (seconds)

  if (mass <= 0) return 0;

  const coefficient = (HBAR * Math.pow(C, 4)) / (15360 * Math.PI * G * G);

  // dM/dt = - coefficient / M^2
  const dMdt = -coefficient / (mass * mass);

  return dMdt * dt;
}



/******************************************************************
 * 13. UTILITIES
 ******************************************************************/

function randomRange(a, b) {
  return a + Math.random() * (b - a);
}

function metersToPixels(meters) {
  return meters * (app.screen.width / SCREEN_WIDTH_METERS);
}

/*function worldToScreen(x, y, parallax = 1) {
  const gs = gameState.gs[0];

  return {
    x: app.screen.width / 2 + metersToPixels((x - gs.x) * parallax),
    y: app.screen.height / 2 + metersToPixels((y - gs.y) * parallax)
  };
}*/

function worldToScreen(x, y, parallax = 1) {
  const gs = gameState.gs[0];

  return {
    x: app.screen.width / 2 + metersToPixels(x - gs.x * parallax),
    y: app.screen.height / 2 + metersToPixels(y - gs.y * parallax)
  };
}

function wrapUniversePosition(body) {
  const rMax = UNIVERSE_RADIUS_METERS;

  const dx = body.x;
  const dy = body.y;
  const r = Math.hypot(dx, dy);

  if (r <= rMax) return;

  // How far outside the universe the body is
  const overflow = r - rMax;

  // Unit direction vector
  const ux = dx / r;
  const uy = dy / r;

  // Re-enter from opposite side, preserving overflow
  body.x = -ux * (rMax - overflow);
  body.y = -uy * (rMax - overflow);
}


function getColorByMass(mass) {
  // Clamp mass to valid range
  const clampedMass = Math.max(SMALL_BODY_MIN_MASS, Math.min(mass, SMALL_BODY_MAX_MASS));

  // Normalize to [0,1]
  const t = (clampedMass - SMALL_BODY_MIN_MASS) / (SMALL_BODY_MAX_MASS - SMALL_BODY_MIN_MASS);

  // Find position in color array
  const scaledT = t * (SMALL_BODY_COLORS.length - 1);
  const index1 = Math.floor(scaledT);
  const index2 = Math.min(index1 + 1, SMALL_BODY_COLORS.length - 1);

  const fraction = scaledT - index1;

  // Extract RGB channels from hex colors
  const c1 = SMALL_BODY_COLORS[index1];
  const c2 = SMALL_BODY_COLORS[index2];

  const r = ((c1 >> 16) & 0xff) * (1 - fraction) + ((c2 >> 16) & 0xff) * fraction;
  const g = ((c1 >> 8) & 0xff) * (1 - fraction) + ((c2 >> 8) & 0xff) * fraction;
  const b = (c1 & 0xff) * (1 - fraction) + (c2 & 0xff) * fraction;

  // Combine back into hex
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function massToRadius(mass) {
  return 2 + 4 * (mass / M0);
}

function smallBodyMassToRadiusMeters(mass) {
  return Math.cbrt((3 * mass) / (4 * Math.PI * SMALL_BODY_DENSITY));
}

function estimateLifetime(mass) {
  if (mass <= 0) return 0;

  // t_ev = 5120 * π * G^2 * M^3 / (ℏ * c^4)
  return (
    (5120 * Math.PI * G * G * Math.pow(mass, 3)) /
    (HBAR * Math.pow(C, 4))
  );
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function gameOver() {
  console.log("GAME OVER");
  app.ticker.stop();
}
