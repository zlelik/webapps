"use strict";


/******************************************************************
 * 1. CONSTANTS & GLOBAL CONFIG
 ******************************************************************/

const G = 6.67430e-11;      // m^3 kg^-1 s^-2
const C = 299792458;       // m/s
const HBAR = 1.054571817e-34;  // J·s

// --- Gravitational Singularity ---
const M0 = 1.52786e6; // kg
const INITIAL_GS_SPEED = 0.1 * C;
const MAX_SPEED = C;
const INITIAL_HALO_ALPHA = 1;
const HALO_SCALE = 2; // halo diameter multiplier
const INNER_FADE_RADIUS = 1; // start fading at GS radius

// --- Timing ---
const PHYSICS_FPS = 40;
const PHYSICS_DT = 1 / PHYSICS_FPS;
const THRUST_DELTA_MASS_EJECTION = M0 * 0.01;
const THRUST_MASS_RATIO = 0.1;
const THRUST_REPEAT_MS = 50;
const THRUST_BEAM_LENGTH_SCREEN_RATIO = 1.5;
const THRUST_BEAM_FINAL_WIDTH_MULTIPLIER = 2;
const THRUST_BEAM_ALPHA = 0.2;
const THRUST_BEAM_DURATION_MS = 300;
const THRUST_BEAM_COLOR = 0xFFFF00;

// --- Scaling ---
const SCREEN_WIDTH_METERS = 1.49896e8;
const UNIVERSE_DIAMETER_METERS = SCREEN_WIDTH_METERS*60;//8.99377e9;
const UNIVERSE_RADIUS_METERS = UNIVERSE_DIAMETER_METERS / 2;
const GS_INITIAL_SCREEN_RATIO = 0.03;
const STAR_PARALLAX_FACTOR = 0.05;
const GRAVITY_SCALE = 1e27; // tune this to adjust gravitational strength

const HALO_BEAM_COUNT = 100;
const HALO_BEAM_WIGGLE = 25;
const HALO_BEAM_SEGMENTS = 10;
const HALO_FIRST_SEGMENTS_WIDTH = 8;
const HALO_BEAM_REFRESH_FPS = 5;
const HALO_BEAM_REFRESH_INTERVAL = 1000 / HALO_BEAM_REFRESH_FPS;

// --- Small bodies ---
const TOTAL_SMALL_BODIES_MASS = 50 * M0;
const SMALL_BODY_MIN_MASS = 0.001 * M0;
const SMALL_BODY_MAX_MASS = 0.05 * M0;
const SMALL_BODY_MIN_SPEED = 0.0001 * C;
const SMALL_BODY_MAX_SPEED = 0.001 * C;
const SMALL_BODY_INFLUENCE_RADIUS_MULT = 7;
const SMALL_BODY_DENSITY = 1e-14; // kg/m³

const GROUP_GENERATORS = [
  { name: "disk",    weight: 1, color: 0x00FF00, create: createDiskGroup },// green
  { name: "spiral",  weight: 1, color: 0xade0ff, create: createSpiralGalaxy },//light blue
  { name: "globular_cluster",  weight: 1, color: 0xefc7ff, create: createGlobularCluster },// purple
  { name: "comet",   weight: 1, color: 0xadf7c2, create: createComet },//light green
  { name: "fractal", weight: 1, color: 0xffa600, create: createFractalCloud },//orange
  { name: "ring",    weight: 1, color: 0xFFFFFF, create: createRing },//white
  { name: "cross",   weight: 1, color: 0xf5ff6e, create: createCrossXShape }//yellow-green
];

// --- Background ---
const BASELINE_WIDTH = 1920;
const BASELINE_HEIGHT = 1080;
const BASELINE_STAR_COUNT = 10000;

const STAR_SIZE_MIN = 1;
const STAR_SIZE_MAX = 3;

// Gravtational Lensing
let grLensingFilter;
let grLensingUniforms;
const vertex = `
  in vec2 aPosition;
  out vec2 vTextureCoord;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
  }
`;

const fragment = `
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform vec2 uUvMin;    
  uniform vec2 uUvMax;    
  uniform float uAspect;  
  uniform float uHeight;  // Add this new variable for screen height
  uniform float uRadius;  // This is now in pixels
  uniform float uEnabled;

  void main(void) {
    vec2 uv = vTextureCoord;

    if (uEnabled > 0.5) {
      // 1. Normalize UV
      vec2 screenUV = (uv - uUvMin) / (uUvMax - uUvMin);
      
      // 2. Center of the screen
      vec2 center = vec2(0.5, 0.5);
      vec2 diff = screenUV - center;

      // 3. Fix aspect ratio
      diff.x *= uAspect;

      // Get distance in 0.0 to 1.0 range, then change to real pixels
      float dist = length(diff);
      float distPx = dist * uHeight;

      // --- LIMIT THE GRAVITATIONAL LENSING RANGE ---
      //float uMaxRadiusPx = uRadius * 7.0; // limit lensing effect to 7x the radius
      //if (distPx > uMaxRadiusPx) {
      //    finalColor = texture(uTexture, uv);
      //    return;
     //}

      // 4. Black hole core using real pixels
      if (distPx < uRadius) {
        finalColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // 5. Lensing math using real pixels
      float deformationPx = (uRadius * uRadius) / distPx;
      float sampleDistPx = distPx - deformationPx;

      // Change back to 0.0 to 1.0 range
      float sampleDist = sampleDistPx / uHeight;

      vec2 dir = normalize(diff);
      dir.x /= uAspect; 

      // 6. Move screenUV and change back to real texture UV
      screenUV = center + dir * sampleDist;
      uv = uUvMin + screenUV * (uUvMax - uUvMin);
    }

    finalColor = texture(uTexture, uv);
  }
`;

const SMALL_BODY_COLORS = [
  0x8B4513, // brown
  0xFF0000, // red
  0xFF7F00, // orange
  0xFFFF00, // yellow
  0x00FF00, // green
  0x0000FF, // blue
  0xADD8E6, // blue-white (light blue)
  0xFFFFFF  // white
];

const smallBodyTextureCache = new Map();

/******************************************************************
 * 2. GLOBAL STATE
 ******************************************************************/

let app = null;
let physicsAccumulator = 0;
let universeBorder;
let starsContainer;
let starsGraphics;
let gameLoopTicker = null;
let gameMountNode = null;

let thrustIntervalId = null;
let thrustDx = 0;
let thrustDy = 0;
let pointerThrustActive = false;
const activeKeys = new Set();

let isGameOver = false;
let explosionParticles = [];

let gameState = createInitialGameState();

         
let ui = {};

function createInitialGameState() {
  return {
    time: 0,
    maxMass: 0,
    nextBodyId: 1,
    gs: [],
    smallBodies: [],
    stars: []
  };
}

function resetRuntimeState() {
  physicsAccumulator = 0;
  universeBorder = null;
  starsContainer = null;
  starsGraphics = null;
  thrustIntervalId = null;
  thrustDx = 0;
  thrustDy = 0;
  isGameOver = false;
  explosionParticles = [];
  gameState = createInitialGameState();
  ui = {};
}


/******************************************************************
 * 3. PUBLIC GAME API
 ******************************************************************/

window.startPOSGame = startPOSGame;
window.stopPOSGame = stopPOSGame;

async function startPOSGame(options = {}) {
  if (app) {
    stopPOSGame();
  }

  gameMountNode = options.mountNode || document.body;

  clearSmallBodyTextureCache();
  resetRuntimeState();
  await initPixi(gameMountNode);
  initGame();
  initInput();
  startGameLoop();
}

function stopPOSGame() {
  stopThrust();
  removeInputHandlers();
  activeKeys.clear();
  pointerThrustActive = false;

  if (app && gameLoopTicker) {
    app.ticker.remove(gameLoopTicker);
    gameLoopTicker = null;
  }

  if (app) {
    app.destroy(true, { children: true });
    app = null;
  }

  if (gameMountNode) {
    gameMountNode.replaceChildren();
  }

  const statsPanel = document.getElementById("gameStatsPanel");
  if (statsPanel) {
    statsPanel.textContent = "";
  }
  const gameOverDialog = document.getElementById("gameOverDialog");
  if (gameOverDialog) {
    gameOverDialog.style.display = "none";
  }

  clearSmallBodyTextureCache();
  gameMountNode = null;
  resetRuntimeState();
}

function clearSmallBodyTextureCache() {
  for (const texture of smallBodyTextureCache.values()) {
    if (texture && !texture.destroyed) {
      texture.destroy(true);
    }
  }
  smallBodyTextureCache.clear();
}


/******************************************************************
 * 4. PIXI INITIALIZATION
 ******************************************************************/

async function initPixi(mountNode) {
  app = new PIXI.Application();
  await app.init({
    resizeTo: mountNode,
    backgroundColor: 0x000000,
    antialias: true
  });
  mountNode.appendChild(app.canvas);
}


/******************************************************************
 * 5. GAME INITIALIZATION
 ******************************************************************/

function initGame() {
  createGS();

  const gs = gameState.gs[0];
  const gsRadiusPx = gs ? gs.radiusRatio * app.screen.width : 0;

  // Initialize gravitational lensing filter
  grLensingUniforms = new PIXI.UniformGroup({
    uUvMin: { value: [0, 0], type: 'vec2<f32>' },
    uUvMax: { value: [1, 1], type: 'vec2<f32>' },
    uAspect: { value: 1.0, type: 'f32' },
    uHeight: { value: 1.0, type: 'f32' },   // Add height variable
    uRadius: { value: gsRadiusPx, type: 'f32' }, // Set radius in pixels
    uEnabled: { value: 0.0, type: 'f32' },
  });

  /* ----------- FILTER ----------- */
  grLensingFilter = PIXI.Filter.from({
      gl: { vertex, fragment },
      resources: { grLensingUniforms },
  });

  grLensingFilter.apply = function(filterManager, input, output, clearMode) {
    const uvs = input.uvs;

    this.resources.grLensingUniforms.uniforms.uUvMin[0] = uvs.x0; 
    this.resources.grLensingUniforms.uniforms.uUvMin[1] = uvs.y0; 
    this.resources.grLensingUniforms.uniforms.uUvMax[0] = uvs.x2; 
    this.resources.grLensingUniforms.uniforms.uUvMax[1] = uvs.y2; 

    const width = input.frame.width;
    const height = input.frame.height;
    
    this.resources.grLensingUniforms.uniforms.uAspect = width / height;
    
    // Pass the real height to the shader
    this.resources.grLensingUniforms.uniforms.uHeight = height; 

    filterManager.applyFilter(this, input, output, clearMode);
  };

  createStars();
  createInitialSmallBodies();
  createUI();
  createUniverseBorder();
}


/******************************************************************
 * 6. INPUT
 ******************************************************************/

function initInput() {
  addInputHandlers();
}

function addInputHandlers() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  window.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  window.addEventListener("mouseleave", onPointerUp);

  window.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);
  window.addEventListener("touchcancel", onPointerUp);
}

function removeInputHandlers() {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);

  window.removeEventListener("mousedown", onPointerDown);
  window.removeEventListener("mousemove", onPointerMove);
  window.removeEventListener("mouseup", onPointerUp);
  window.removeEventListener("mouseleave", onPointerUp);

  window.removeEventListener("touchstart", onPointerDown);
  window.removeEventListener("touchmove", onPointerMove);
  window.removeEventListener("touchend", onPointerUp);
  window.removeEventListener("touchcancel", onPointerUp);
}

function onKeyDown(e) {
  if (!isArrowKey(e.key)) return;
  e.preventDefault();
  activeKeys.add(e.key);
  refreshKeyboardThrust();
}

function onKeyUp(e) {
  if (!isArrowKey(e.key)) return;
  e.preventDefault();
  activeKeys.delete(e.key);
  refreshKeyboardThrust();
}

function isArrowKey(key) {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown"
  );
}

function onPointerDown(e) {
  if (!shouldHandleGameplayPointerEvent(e)) return;
  e.preventDefault();
  pointerThrustActive = true;
  updatePointerThrustDirection(e);
}

function onPointerMove(e) {
  if (!pointerThrustActive) return;
  if (!shouldHandleGameplayPointerEvent(e)) return;
  e.preventDefault();
  updatePointerThrustDirection(e);
}

function onPointerUp() {
  pointerThrustActive = false;
  refreshKeyboardThrust();
}

function shouldHandleGameplayPointerEvent(e) {
  const gameLayer = document.getElementById("gameLayer");
  const gameHost = document.getElementById("gameHost");
  if (!gameLayer || !gameHost) return false;
  if (gameLayer.style.display === "none") return false;

  const target = e.target;
  if (!(target instanceof Element)) return false;

  const isInsideGameHost = gameHost.contains(target);
  if (!isInsideGameHost) return false;

  return true;
}

function updatePointerThrustDirection(e) {
  const pos = getPointerPosition(e);
  if (!pos) return;

  const x = pos.x;
  const y = pos.y;

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  const dx = x - cx;
  const dy = y - cy;
  setThrust(dx, dy);
}

function getPointerPosition(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    return { x: e.clientX, y: e.clientY };
  }
  return null;
}

function refreshKeyboardThrust() {
  if (pointerThrustActive) return;
  const dx = (activeKeys.has("ArrowRight") ? 1 : 0) - (activeKeys.has("ArrowLeft") ? 1 : 0);
  const dy = (activeKeys.has("ArrowDown") ? 1 : 0) - (activeKeys.has("ArrowUp") ? 1 : 0);
  setThrust(dx, dy);
}

function setThrust(dx, dy) {
  const norm = Math.hypot(dx, dy);
  if (norm === 0) {
    stopThrust();
    return;
  }

  const nextDx = dx / norm;
  const nextDy = dy / norm;
  const directionChanged = nextDx !== thrustDx || nextDy !== thrustDy;

  thrustDx = nextDx;
  thrustDy = nextDy;

  if (thrustIntervalId === null) {
    applyMomentumThrust(thrustDx, thrustDy);
    thrustIntervalId = setInterval(() => {
      applyMomentumThrust(thrustDx, thrustDy);
    }, THRUST_REPEAT_MS);
    return;
  }

  if (directionChanged) {
    applyMomentumThrust(thrustDx, thrustDy);
  }
}

function stopThrust() {
  if (thrustIntervalId !== null) {
    clearInterval(thrustIntervalId);
    thrustIntervalId = null;
  }
}

/******************************************************************
 * 7. GAME LOOP
 ******************************************************************/

function startGameLoop() {
  if (!app) return;

  if (gameLoopTicker) {
    app.ticker.remove(gameLoopTicker);
  }

  gameLoopTicker = () => {
    const dt = app.ticker.elapsedMS / 1000;

    if (isGameOver) {
      updateExplosion(dt);
      return;
    }
    

    physicsAccumulator += dt;
    while (physicsAccumulator >= PHYSICS_DT) {
      updatePhysics(PHYSICS_DT);
      physicsAccumulator -= PHYSICS_DT;
    }

    render();
  };

  app.ticker.add(gameLoopTicker);
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
    lightningHalo: new PIXI.Graphics(),
    thrustBeam: new PIXI.Graphics(),
    thrustBeamEffect: null
  };
  gs.lightningHalo.filters = [new PIXI.BlurFilter({ strength: 8, quality: 4 })];
  gameState.gs.push(gs);
  gameState.maxMass = gs.mass;
  
  app.stage.addChild(gs.halo);
  app.stage.addChild(gs.thrustBeam);
  app.stage.addChild(gs.sprite);
  app.stage.addChild(gs.lightningHalo);
}


function createStars() {
  starsContainer = new PIXI.Container();
  starsGraphics = new PIXI.Graphics();

  starsContainer.addChild(starsGraphics);
  app.stage.addChild(starsContainer);

  // Apply the filter here, ONCE.
  grLensingUniforms.uniforms.uEnabled = 1.0;
  starsContainer.filters = [grLensingFilter];
  
  // Lock the filter to the screen so it doesn't move with the stars
  //starsContainer.filterArea = app.screen;

  const STAR_COUNT = computeStarCount();

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

function computeStarCount() {
  const currentArea = app.screen.width * app.screen.height;
  const baselineArea = BASELINE_WIDTH * BASELINE_HEIGHT;

  const scale = currentArea / baselineArea;

  const minStars = 500;
  const maxStars = 15000;

  return Math.round(
    Math.min(maxStars, Math.max(minStars, BASELINE_STAR_COUNT * scale))
  );
}

function createUI() {
  ui.statsPanel = document.getElementById("gameStatsPanel");
  ui.gameOverDialog = document.getElementById("gameOverDialog");
  ui.restartButton = document.getElementById("restartGameButton");

  if (ui.gameOverDialog) {
    ui.gameOverDialog.style.display = "none";
  }

  if (ui.restartButton) {
    ui.restartButton.onclick = restartGame;
  }
}

function createUniverseBorder() {
  universeBorder = new PIXI.Graphics();
  app.stage.addChild(universeBorder);
}

function createInitialSmallBodies() {
  let totalMass = 0;
  
  // Create specific small bodygroup close to GS
  const gen = GROUP_GENERATORS[1];
  const params = makeRandomGroupParams();
  const gs = gameState.gs[0];
  params.N = 150;
  params.centerX = gs.x - SCREEN_WIDTH_METERS*0.8;
  params.centerY = gs.y - SCREEN_WIDTH_METERS*0.1;
  params.vx = INITIAL_GS_SPEED*1.9;
  params.vy = -INITIAL_GS_SPEED*0.02;
  params.radius = SCREEN_WIDTH_METERS*0.15;
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
}

function createSmallBody(mass) {
  const angle = Math.random() * Math.PI * 2;
  const speed = randomRange(SMALL_BODY_MIN_SPEED, SMALL_BODY_MAX_SPEED);

  // Uniform random position inside universe circle
  const theta = Math.random() * Math.PI * 2;
  const r = UNIVERSE_RADIUS_METERS * Math.sqrt(Math.random());

  const x = Math.cos(theta) * r;
  const y = Math.sin(theta) * r;
  const sprite = createSmallBodySprite(mass);
  return {
    id: gameState.nextBodyId++,
    mass: mass,
    x: x,
    y: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    
    sprite: sprite,
    color: color
  };
}

function createSmallBodySprite(mass, colorArg = null) {
  const radiusPx = metersToPixels(
    smallBodyMassToRadiusMeters(mass)
  );

  const sprite = new PIXI.Sprite(
    getSmallBodyTexture(radiusPx)
  );

  const color = colorArg ? colorArg : getColorByMass(mass);

  sprite.anchor.set(0.5);
  sprite.tint = color;
  return sprite;
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
}

function getSmallBodyTexture(radiusPx) {
  const key = Math.round(radiusPx);

  if (!smallBodyTextureCache.has(key)) {
    const g = new PIXI.Graphics();
    g.circle(key, key, key).fill(0xffffff);
    smallBodyTextureCache.set(
      key,
      app.renderer.generateTexture(g)
    );
  }

  return smallBodyTextureCache.get(key);
}

function makeRandomGroupParams() {
  return {
    // common
    N: Math.floor(randomRange(50, 100)),
    centerX: randomRange(-UNIVERSE_RADIUS_METERS, UNIVERSE_RADIUS_METERS),
    centerY: randomRange(-UNIVERSE_RADIUS_METERS, UNIVERSE_RADIUS_METERS),
    radius: randomRange(SCREEN_WIDTH_METERS * 0.05, SCREEN_WIDTH_METERS * 0.3),
    vx: randomRange(-SMALL_BODY_MAX_SPEED, SMALL_BODY_MAX_SPEED),
    vy: randomRange(-SMALL_BODY_MAX_SPEED, SMALL_BODY_MAX_SPEED),

    // spiral galaxy
    armCount: Math.random() < 0.5 ? 2 : 4,
    armTightness: randomRange(1.5, 3),

    // ring
    ringWidthFactor: randomRange(0.08, 0.2),

    // comet
    cometSpeedFactor: randomRange(1.5, 2.5),

    // cross
    crossWidth: Math.random() < 0.5 ? 2 : 3
  };
}


function createRandomSmallBodiesGroup() {
  const gen = pickRandomGenerator(GROUP_GENERATORS);
  const params = makeRandomGroupParams();
  if (gen.name == "fractal") {
    gen.N = Math.floor(randomRange(950, 1100));
  }
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

    const mass = randomRange(SMALL_BODY_MIN_MASS*0.6, SMALL_BODY_MIN_MASS*0.9);

    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
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

  const coreFraction = 0.3;               // 30% of bodies in core
  const coreRadius = radius * 0.2;        // compact bulge
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

    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
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

    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}

function randomGaussian(sigma) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}


function createGlobularCluster({
  N,
  centerX,
  centerY,
  radius,
  vx = 0,
  vy = 0,
  color
}) {
  const bodies = [];

  const sigma = radius * randomRange(0.3, 0.5);
  const radiusMax = radius;//3 * sigma;

  // number of radial filaments
  const lineCount = Math.floor(randomRange(15, 25));

  // precompute filament angles
  const angles = [];
  for (let i = 0; i < lineCount; i++) {
    angles.push((i / lineCount) * Math.PI * 2);
  }

  const jitter = radius * randomRange(0.02, 0.04);

  while (bodies.length < N) {
    // choose filament
    const a = angles[Math.floor(Math.random() * angles.length)];

    // 1D Gaussian along the filament
    const r = Math.abs(randomGaussian(sigma));
    if (r > radiusMax) continue;

    // perpendicular jitter
    const offset = randomGaussian(jitter);

    const cosA = Math.cos(a);
    const sinA = Math.sin(a);

    const x =
      centerX +
      r * cosA -
      offset * sinA;

    const y =
      centerY +
      r * sinA +
      offset * cosA;

    const mass = randomRange(
      SMALL_BODY_MIN_MASS * 0.6,
      SMALL_BODY_MIN_MASS * 0.9
    );

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: createSmallBodySprite(mass, color),
      color
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

    const mass = randomRange(SMALL_BODY_MIN_MASS*0.6, SMALL_BODY_MIN_MASS*0.9);
    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
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

    const mass = randomRange(SMALL_BODY_MIN_MASS*0.6, SMALL_BODY_MIN_MASS*0.9);
    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
      color: color || getColorByMass(mass)
    });
  }

  return bodies;
}

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

  // ---- Mandelbrot zoom parameters (chosen region) ----
  const fractalScale = 3.5643053873601143e-9;//2.2808981735594034e-9;//0.0000000025;
  const fractalCenterX = 0.2937032657404631;//-0.7436334;
  const fractalCenterY = 0.018861246195852877;//0.1318748;
  const maxIter = 300;//250;

  const sampleSize = 800;
  const halfSample = sampleSize / 2;

  while (bodies.length < N) {

    // random point in sampling window
    const px = Math.random() * sampleSize - halfSample;
    const py = Math.random() * sampleSize - halfSample;

    // convert to Mandelbrot complex coordinate
    const x0 = fractalCenterX + px * fractalScale;
    const y0 = fractalCenterY + py * fractalScale;

    let x = 0;
    let y = 0;
    let iter = 0;

    while (x * x + y * y <= 4 && iter < maxIter) {
      const xt = x * x - y * y + x0;
      y = 2 * x * y + y0;
      x = xt;
      iter++;
    }

    // keep Mandelbrot interior points
    if (iter === maxIter) {

      // map fractal sampling window → physical radius
      const xLocal = (px / halfSample) * radius;
      const yLocal = (py / halfSample) * radius;

      const mass = randomRange(SMALL_BODY_MIN_MASS * 0.5, SMALL_BODY_MIN_MASS * 0.7);

      bodies.push({
        id: gameState.nextBodyId++,
        mass,
        x: centerX + xLocal,
        y: centerY + yLocal,
        vx,
        vy,
        sprite: createSmallBodySprite(mass, color),
        color
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

    const mass = randomRange(SMALL_BODY_MIN_MASS*0.6, SMALL_BODY_MIN_MASS*0.9);
    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
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
  color,
  crossWidth = 1
}) {
  const bodies = [];
  const width = Math.max(1, Math.floor(crossWidth));
  const avgMass = SMALL_BODY_MIN_MASS * 0.75;
  const laneSpacing = smallBodyMassToRadiusMeters(avgMass) * 2.2;
  const laneOffsets = Array.from({ length: width }, (_, i) => i - (width - 1) / 2);

  function addCrossBody(t, diagonal, laneOffsetMeters) {
    if (bodies.length >= N) return;

    const perpX = -diagonal;
    const perpY = 1;
    const x = centerX + t + laneOffsetMeters * perpX;
    const y = centerY + diagonal * t + laneOffsetMeters * perpY;
    const mass = randomRange(SMALL_BODY_MIN_MASS*0.6, SMALL_BODY_MIN_MASS*0.9);
    const sprite = createSmallBodySprite(mass, color);

    bodies.push({
      id: gameState.nextBodyId++,
      mass,
      x,
      y,
      vx,
      vy,
      sprite: sprite,
      color: color || getColorByMass(mass)
    });
  }

  // Distribute N bodies evenly across cross lines and place points uniformly.
  const basePerLane = Math.floor(N / width);
  let remainder = N % width;

  for (let lane = 0; lane < width && bodies.length < N; lane++) {
    const laneCount = basePerLane + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    const laneOffsetMeters = laneOffsets[lane] * laneSpacing;

    for (let i = 0; i < laneCount && bodies.length < N; i++) {
      const diagonal = i % 2 === 0 ? 1 : -1;
      const t =
        -radius + ((i + Math.random()) / Math.max(1, laneCount)) * (2 * radius);
      addCrossBody(t, diagonal, laneOffsetMeters);
    }
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

  gameState.maxMass = Math.max(gameState.maxMass, gs.mass);

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

    const dxBeforeMove = obj.x - gsX;
    const dyBeforeMove = obj.y - gsY;
    const distanceBeforeMove = Math.hypot(dxBeforeMove, dyBeforeMove);
    
    const smallBodyRadiusMeters = smallBodyMassToRadiusMeters(obj.mass);

    // Apply gravity only inside influence radius
    if (distanceBeforeMove < influenceRadius) {
      applyPWGravity(obj, dxBeforeMove, dyBeforeMove, distanceBeforeMove, dt);
    } else {
      // Move with constant velocity
      obj.x += obj.vx * dt;
      obj.y += obj.vy * dt;
    }

    // Absorption by GS (check after motion to avoid stale-distance misses)
    const dxAfterMove = obj.x - gsX;
    const dyAfterMove = obj.y - gsY;
    const distanceAfterMove = Math.hypot(dxAfterMove, dyAfterMove);
    if (distanceAfterMove < (gsRadiusMeters + smallBodyRadiusMeters)) {
      //increase GS mass by the mass of absorbed small body
      gs.mass += obj.mass;
      //obj.sprite.clear();
      app.stage.removeChild(obj.sprite);
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

  const thrustNorm = Math.hypot(dx, dy);
  if (thrustNorm === 0) return;
  const nx = dx / thrustNorm;
  const ny = dy / thrustNorm;

  if (gs.mass <= THRUST_DELTA_MASS_EJECTION) return;

  // Mass loss
  gs.mass -= THRUST_DELTA_MASS_EJECTION * THRUST_MASS_RATIO;

  // Radiation momentum: p = Δm * c
  const recoilMomentum = THRUST_DELTA_MASS_EJECTION * C;

  // Effective recoil speed from relativistic momentum:
  // p = gamma*m*u  =>  u = (p*c) / sqrt((m*c)^2 + p^2)
  // This keeps u strictly subluminal without ad-hoc clamps.
  const mc = gs.mass * C;
  const u = (recoilMomentum * C) / Math.sqrt(mc * mc + recoilMomentum * recoilMomentum);

  // Decompose current velocity into components parallel/perpendicular to thrust axis
  const vParallel = gs.vx * nx + gs.vy * ny;
  const vPerpX = gs.vx - nx * vParallel;
  const vPerpY = gs.vy - ny * vParallel;

  // Full relativistic velocity composition for boost along thrust axis
  const c2 = C * C;
  const gammaU = 1 / Math.sqrt(1 - (u * u) / c2);
  const denom = 1 + (vParallel * u) / c2;
  if (denom <= 1e-12) return;

  const vParallelNew = (vParallel + u) / denom;
  const vPerpScale = 1 / (gammaU * denom);
  const vPerpXNew = vPerpX * vPerpScale;
  const vPerpYNew = vPerpY * vPerpScale;

  gs.vx = nx * vParallelNew + vPerpXNew;
  gs.vy = ny * vParallelNew + vPerpYNew;

  limitVelocity(gs, MAX_SPEED);
  triggerThrustBeam(gs, nx, ny);
}

function limitVelocity(body, maxSpeed) {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed <= maxSpeed) return;

  const scale = maxSpeed / speed;
  body.vx *= scale;
  body.vy *= scale;
}


/******************************************************************
 * 11. RENDERING
 ******************************************************************/

function render() {
  renderStars();
  //render small bodies first so GS is on top and in case of physics/rendering timing mistmatch, that it does not look like small body is not absorbed by GS.
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
    const visible = (obj.x >= minX && obj.x <= maxX) && (obj.y >= minY && obj.y <= maxY);

    obj.sprite.visible = visible;

    if (visible) {
      const screenPos = worldToScreen(obj.x, obj.y);
      obj.sprite.x = screenPos.x;
      obj.sprite.y = screenPos.y;
    }
  }
}

function renderStars() {
  const gs = gameState.gs[0];

  starsContainer.x = app.screen.width * 0.5 - metersToPixels(gs.x * STAR_PARALLAX_FACTOR);

  starsContainer.y = app.screen.height * 0.5 - metersToPixels(gs.y * STAR_PARALLAX_FACTOR);

}

function renderGS() {
  const gs = gameState.gs[0];
  renderThrustBeam(gs);
  //renderHalo(gs);
  renderLightningHalo(gs);
  //drawLightning(100, 100, 500, 300, 10, 30, 0x00FF00);
  const screenPos = worldToScreen(gs.x, gs.y);
  const radiusPx = gs.radiusRatio * app.screen.width;

  grLensingUniforms.uniforms.uRadius = radiusPx;

  gs.sprite.clear();
  gs.sprite.circle(screenPos.x, screenPos.y, radiusPx).fill(0x000000);
}

function triggerThrustBeam(gs, thrustNx, thrustNy) {
  const screenPos = worldToScreen(gs.x, gs.y);
  const beamDirX = -thrustNx;
  const beamDirY = -thrustNy;

  const beamLengthPx =
    Math.min(app.screen.width, app.screen.height) * THRUST_BEAM_LENGTH_SCREEN_RATIO;
  const gsWidthPx = gs.radiusRatio * app.screen.width * 2;
  const startWidthPx = gsWidthPx;
  const endWidthPx = gsWidthPx * THRUST_BEAM_FINAL_WIDTH_MULTIPLIER;

  gs.thrustBeamEffect = {
    startX: screenPos.x,
    startY: screenPos.y,
    endX: screenPos.x + beamDirX * beamLengthPx,
    endY: screenPos.y + beamDirY * beamLengthPx,
    startWidth: startWidthPx,
    endWidth: endWidthPx,
    activeUntil: performance.now() + THRUST_BEAM_DURATION_MS
  };
}

function renderThrustBeam(gs) {
  const g = gs.thrustBeam;
  g.clear();

  const effect = gs.thrustBeamEffect;
  if (!effect) return;
  if (performance.now() > effect.activeUntil) {
    gs.thrustBeamEffect = null;
    return;
  }

  const dx = effect.endX - effect.startX;
  const dy = effect.endY - effect.startY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;

  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;

  const startHalf = effect.startWidth * 0.5;
  const endHalf = effect.endWidth * 0.5;

  const x1 = effect.startX + px * startHalf;
  const y1 = effect.startY + py * startHalf;
  const x2 = effect.startX - px * startHalf;
  const y2 = effect.startY - py * startHalf;
  const x3 = effect.endX - px * endHalf;
  const y3 = effect.endY - py * endHalf;
  const x4 = effect.endX + px * endHalf;
  const y4 = effect.endY + py * endHalf;

  g.poly([x1, y1, x2, y2, x3, y3, x4, y4]).fill({
    color: THRUST_BEAM_COLOR,
    alpha: THRUST_BEAM_ALPHA
  });
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

function getHaloColor(mass) {
  const m = mass / M0;

  // Define anchor points (mass ratio → color)
  const stops = [
    { m: 0.05, color: 0xFFFFFF },
    { m: 0.25, color: 0xa4daf5 },
    { m: 1,    color: 0x68c4f2 },
    { m: 3,    color: 0xff8400 },
    { m: 5,    color: 0xFF0000 },
    { m: 8,    color: 0x996c02 },
    { m: 12,   color: 0x000000 }
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

function triggerGSExplosion(gs) {
  const center = worldToScreen(gs.x, gs.y);

  for (let i = 0; i < 200; i++) {
    const g = new PIXI.Graphics();
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(200, 600);

    g.beginFill(0xff0044);
    g.circle(0, 0, randomRange(2, 4));
    g.endFill();

    g.x = center.x;
    g.y = center.y;

    explosionParticles.push({
      gfx: g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randomRange(0.8, 1.5)
    });

    app.stage.addChild(g);
  }
}

function updateExplosion(dt) {
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];

    p.life -= dt;
    p.gfx.x += p.vx * dt;
    p.gfx.y += p.vy * dt;
    p.gfx.alpha = Math.max(0, p.life);

    if (p.life <= 0) {
      app.stage.removeChild(p.gfx);
      explosionParticles.splice(i, 1);
    }
  }
}

function showGameOverOverlay() {
  if (ui.gameOverDialog) {
    ui.gameOverDialog.style.display = "flex";
  }
}

function renderUI() {
  const gs = gameState.gs[0];
  const speed = Math.hypot(gs.vx, gs.vy);
  const lifetime = estimateLifetime(gs.mass);

  if (ui.statsPanel) {
    ui.statsPanel.textContent =
`Mass: ${(gs.mass / 1e6).toFixed(2)} kton
Speed: ${speed.toFixed(1)} m/s (${(speed / C).toFixed(3)}c)
Remaining Lifetime: ${formatTime(lifetime)}
Maximum Mass: ${(gameState.maxMass / 1e6).toFixed(2)} kton
Playing Time: ${formatTime(gameState.time)}`;
//Total SB M: ${((gameState.smallBodies.reduce((sum, o) => sum + o.mass, 0)) / 1e6).toFixed(2)} kton`;//keep it for debuging
  }
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
  const totalSeconds = Math.max(0, Math.floor(sec));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function gameOver() {
  if (isGameOver || !app) return;
  isGameOver = true;
  gameState.maxMass = 0;

  stopThrust();
  //app.ticker.stop();

  triggerGSExplosion(gameState.gs[0]);
  //add waiting time here.
  await sleep(2000);
  if (!app) return;
  showGameOverOverlay();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function restartGame() {
  if (!app) return;
  await sleep(500);
  if (!app) return;
  app.stage.removeChildren();
  explosionParticles.length = 0;
  isGameOver = false;
  if (ui.gameOverDialog) {
    ui.gameOverDialog.style.display = "none";
  }

  gameState = createInitialGameState();

  physicsAccumulator = 0;

  initGame();
  app.ticker.start();
}

/******************************************************************
 * 15. START SCREEN CONTROLLER
 ******************************************************************/

function initStartScreenController() {
  const fullscreenEnterSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true" style="fill: currentColor; display: block;"><path d="M128 96C110.3 96 96 110.3 96 128L96 224C96 241.7 110.3 256 128 256C145.7 256 160 241.7 160 224L160 160L224 160C241.7 160 256 145.7 256 128C256 110.3 241.7 96 224 96L128 96zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 512C96 529.7 110.3 544 128 544L224 544C241.7 544 256 529.7 256 512C256 494.3 241.7 480 224 480L160 480L160 416zM416 96C398.3 96 384 110.3 384 128C384 145.7 398.3 160 416 160L480 160L480 224C480 241.7 494.3 256 512 256C529.7 256 544 241.7 544 224L544 128C544 110.3 529.7 96 512 96L416 96zM544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480L416 480C398.3 480 384 494.3 384 512C384 529.7 398.3 544 416 544L512 544C529.7 544 544 529.7 544 512L544 416z"/></svg>';
  const fullscreenExitSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true" style="fill: currentColor; display: block;"><path d="M256 128C256 110.3 241.7 96 224 96C206.3 96 192 110.3 192 128L192 192L128 192C110.3 192 96 206.3 96 224C96 241.7 110.3 256 128 256L224 256C241.7 256 256 241.7 256 224L256 128zM128 384C110.3 384 96 398.3 96 416C96 433.7 110.3 448 128 448L192 448L192 512C192 529.7 206.3 544 224 544C241.7 544 256 529.7 256 512L256 416C256 398.3 241.7 384 224 384L128 384zM448 128C448 110.3 433.7 96 416 96C398.3 96 384 110.3 384 128L384 224C384 241.7 398.3 256 416 256L512 256C529.7 256 544 241.7 544 224C544 206.3 529.7 192 512 192L448 192L448 128zM416 384C398.3 384 384 398.3 384 416L384 512C384 529.7 398.3 544 416 544C433.7 544 448 529.7 448 512L448 448L512 448C529.7 448 544 433.7 544 416C544 398.3 529.7 384 512 384L416 384z"/></svg>';

  const startScreen = document.getElementById("startScreen");
  const gameLayer = document.getElementById("gameLayer");
  const gameHost = document.getElementById("gameHost");
  const startButton = document.getElementById("startGameButton");
  const exitButton = document.getElementById("exitGameButton");
  const fullscreenButton = document.getElementById("fullscreenGameButton");

  if (!startScreen || !gameLayer || !gameHost || !startButton || !exitButton || !fullscreenButton) {
    return;
  }

  function updateFullscreenButtonIcon() {
    const isFullscreen = document.fullscreenElement === gameLayer;
    fullscreenButton.innerHTML = isFullscreen ? fullscreenExitSvg : fullscreenEnterSvg;
  }

  updateFullscreenButtonIcon();

  let isLaunching = false;

  async function launchGame() {
    if (isLaunching) return;
    isLaunching = true;

    try {
      startScreen.style.display = "none";
      gameLayer.style.display = "block";
      await startPOSGame({ mountNode: gameHost });
    } catch (err) {
      console.error("Failed to start game", err);
      gameLayer.style.display = "none";
      startScreen.style.display = "flex";
    } finally {
      isLaunching = false;
    }
  }

  function exitGame() {
    if (document.fullscreenElement === gameLayer) {
      document.exitFullscreen().catch(() => {});
    }
    stopPOSGame();
    gameLayer.style.display = "none";
    startScreen.style.display = "flex";
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === gameLayer) {
        await document.exitFullscreen();
        return;
      }

      if (!document.fullscreenElement) {
        await gameLayer.requestFullscreen();
      }
    } catch (err) {
      console.error("Failed to toggle fullscreen", err);
    }
  }

  startButton.addEventListener("click", launchGame);
  exitButton.addEventListener("click", exitGame);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButtonIcon);
}

document.addEventListener("DOMContentLoaded", initStartScreenController);
