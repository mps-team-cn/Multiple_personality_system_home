type SpinMode = 'idle' | 'dragging' | 'spinning' | 'snapping';

interface DragSample {
  position: number;
  time: number;
}

const COUNT = 20;
const TAU = Math.PI * 2;
const STEP = TAU / COUNT;
const MAX_VELOCITY = 18;
const REDUCED_MAX_VELOCITY = 12;
const FRICTION = 1.22;
const REDUCED_FRICTION = 3.25;
const STOP_THRESHOLD = 0.14;
const SNAP_DURATION = 300;
const REDUCED_SNAP_DURATION = 155;
const SAMPLE_WINDOW = 110;
const BALL_FRICTION = 1.05;
const REDUCED_BALL_FRICTION = 2.8;
const BALL_MIN_VELOCITY = 5;
const BALL_MAX_VELOCITY = 24;

const wheel = document.querySelector<HTMLElement>('#wheel');
const wheelStage = document.querySelector<HTMLElement>('#wheelStage');
const wheelConsole = document.querySelector<HTMLElement>('.wheel-console');
const tickLayer = document.querySelector<HTMLElement>('#tickLayer');
const numberLayer = document.querySelector<HTMLElement>('#numberLayer');
const resultText = document.querySelector<HTMLElement>('#resultText');
const mechanicalNote = document.querySelector<HTMLElement>('#mechanicalNote');
const spinStatus = document.querySelector<HTMLElement>('#spinStatus');
const spinButton = document.querySelector<HTMLButtonElement>('#spinButton');
const soundButton = document.querySelector<HTMLButtonElement>('#soundButton');
const soundState = document.querySelector<HTMLElement>('#soundState');
const readingHead = document.querySelector<HTMLElement>('.reading-head');
const ballOrbit = document.querySelector<HTMLElement>('#ballOrbit');

if (
  !wheel ||
  !wheelStage ||
  !wheelConsole ||
  !tickLayer ||
  !numberLayer ||
  !resultText ||
  !mechanicalNote ||
  !spinStatus ||
  !spinButton ||
  !soundButton ||
  !soundState ||
  !readingHead ||
  !ballOrbit
) {
  throw new Error('Fidget Wheel markup is incomplete.');
}

const wheelElement = wheel;
const wheelStageElement = wheelStage;
const wheelConsoleElement = wheelConsole;
const tickLayerElement = tickLayer;
const numberLayerElement = numberLayer;
const resultTextElement = resultText;
const mechanicalNoteElement = mechanicalNote;
const spinStatusElement = spinStatus;
const spinButtonElement = spinButton;
const soundButtonElement = soundButton;
const soundStateElement = soundState;
const readingHeadElement = readingHead;
const ballOrbitElement = ballOrbit;

const tickElements: HTMLElement[] = [];
let audioContext: AudioContext | null = null;
let animationFrameId: number | null = null;
let mode: SpinMode = 'idle';
let pointerId: number | null = null;
let angularPosition = 0;
let angularVelocity = 0;
let previousFrameTime = 0;
let snapStartPosition = 0;
let snapTargetPosition = 0;
let snapElapsed = 0;
let ballAngularPosition = 0;
let ballAngularVelocity = 0;
let ballSnapStartPosition = 0;
let ballSnapTargetPosition = 0;
let dragStartPosition = 0;
let dragTravel = 0;
let lastPointerAngle: number | null = null;
let dragSamples: DragSample[] = [];
let tickTravel = 0;
let lastTickMarker = 0;
let feedbackStartIndex = 0;
let lastTickSoundTime = -Infinity;
let lastVibrationTime = -Infinity;
let soundEnabled = true;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function shortestAngleDelta(next: number, previous: number): number {
  return normalizeAngle(next - previous);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function getSelectedNumber(position: number = angularPosition): number {
  const nearestMarker = Math.round(position / STEP);
  const index = ((-nearestMarker % COUNT) + COUNT) % COUNT;
  return index + 1;
}

function getNearestSnapTarget(position: number): number {
  return Math.round(position / STEP) * STEP;
}

function setResult(number: number): void {
  resultTextElement.textContent = `当前：${number}`;
  wheelElement.setAttribute('aria-valuenow', String(number));
  wheelElement.setAttribute('aria-valuetext', `当前数字 ${number}`);
}

function setMode(nextMode: SpinMode): void {
  mode = nextMode;
  wheelConsoleElement.classList.toggle('is-spinning', mode !== 'idle');
  spinStatusElement.textContent =
    mode === 'dragging'
      ? '拨动中'
      : mode === 'spinning'
        ? '惯性中'
        : mode === 'snapping'
          ? '吸附中'
          : '待机';
}

function renderPosition(): void {
  wheelElement.style.transform = `rotate(${angularPosition}rad)`;
}

function renderBallPosition(): void {
  ballOrbitElement.style.transform = `rotate(${ballAngularPosition}rad)`;
}

function resetTickTracking(): void {
  tickTravel = 0;
  lastTickMarker = 0;
  feedbackStartIndex = getSelectedNumber() - 1;
}

function flashTick(marker: number): void {
  const index = (((feedbackStartIndex - marker) % COUNT) + COUNT) % COUNT;
  const tick = tickElements[index];
  tick?.classList.add('is-hot');
  readingHeadElement.classList.remove('is-flashing');
  void readingHeadElement.offsetWidth;
  readingHeadElement.classList.add('is-flashing');

  window.setTimeout(() => tick?.classList.remove('is-hot'), 115);
  mechanicalNoteElement.textContent = `刻度 · ${(((index % COUNT) + COUNT) % COUNT) + 1}`;
  playTickFeedback();
}

function triggerCrossedTicks(delta: number): void {
  tickTravel += delta;

  if (delta > 0) {
    while (tickTravel >= (lastTickMarker + 1) * STEP) {
      lastTickMarker += 1;
      flashTick(lastTickMarker);
    }
  } else if (delta < 0) {
    while (tickTravel <= (lastTickMarker - 1) * STEP) {
      lastTickMarker -= 1;
      flashTick(lastTickMarker);
    }
  }
}

function applyPosition(nextPosition: number, shouldTriggerFeedback = true): void {
  const previousPosition = angularPosition;
  angularPosition = normalizeAngle(nextPosition);
  const delta = shortestAngleDelta(angularPosition, previousPosition);
  renderPosition();

  if (shouldTriggerFeedback && Math.abs(delta) > 0) {
    triggerCrossedTicks(delta);
  }
}

function ensureAudio(): AudioContext | null {
  if (!soundEnabled) {
    return null;
  }

  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }
    return audioContext;
  } catch {
    audioContext = null;
    return null;
  }
}

function playTickFeedback(): void {
  const now = performance.now();
  if (soundEnabled && now - lastTickSoundTime >= 28) {
    const context = ensureAudio();
    if (context) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startTime = context.currentTime;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(370, startTime);
      oscillator.frequency.exponentialRampToValueAtTime(235, startTime + 0.045);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.045, startTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.055);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.06);
      lastTickSoundTime = now;
    }
  }

  if ('vibrate' in navigator && now - lastVibrationTime >= 35) {
    try {
      navigator.vibrate(7);
      lastVibrationTime = now;
    } catch {
      // Vibration is an optional enhancement.
    }
  }
}

function trimSamples(now: number): void {
  dragSamples = dragSamples.filter((sample) => now - sample.time <= SAMPLE_WINDOW);
}

function beginAnimation(): void {
  if (animationFrameId === null) {
    previousFrameTime = performance.now();
    animationFrameId = window.requestAnimationFrame(frameAnimation);
  }
}

function stopAnimation(): void {
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function finishSpin(): void {
  stopAnimation();
  angularVelocity = 0;
  ballAngularVelocity = 0;
  angularPosition = normalizeAngle(snapTargetPosition);
  ballAngularPosition = 0;
  renderPosition();
  renderBallPosition();
  const selectedNumber = getSelectedNumber();
  setResult(selectedNumber);
  mechanicalNoteElement.textContent = `停在第 ${selectedNumber} 格`;
  setMode('idle');
}

function getBallSnapTarget(position: number, velocity: number): number {
  let delta = normalizeAngle(-position);
  if (velocity > 0 && delta < 0) {
    delta += TAU;
  } else if (velocity < 0 && delta > 0) {
    delta -= TAU;
  }
  return position + delta;
}

function beginSnap(targetPosition: number = getNearestSnapTarget(angularPosition)): void {
  snapStartPosition = angularPosition;
  snapTargetPosition = targetPosition;
  ballSnapStartPosition = ballAngularPosition;
  ballSnapTargetPosition = getBallSnapTarget(ballAngularPosition, ballAngularVelocity);
  snapElapsed = 0;
  setMode('snapping');
}

function updateSnap(deltaSeconds: number): void {
  snapElapsed += deltaSeconds * 1000;
  const duration = reducedMotion ? REDUCED_SNAP_DURATION : SNAP_DURATION;
  const progress = clamp(snapElapsed / duration, 0, 1);
  const easedProgress = 1 - (1 - progress) ** 3;
  const nextPosition = snapStartPosition + (snapTargetPosition - snapStartPosition) * easedProgress;
  ballAngularPosition =
    ballSnapStartPosition + (ballSnapTargetPosition - ballSnapStartPosition) * easedProgress;
  applyPosition(nextPosition);
  renderBallPosition();

  if (progress >= 1) {
    finishSpin();
  }
}

function frameAnimation(timestamp: number): void {
  animationFrameId = null;
  const elapsed = Math.min(Math.max((timestamp - previousFrameTime) / 1000, 0), 0.035);
  previousFrameTime = timestamp;

  if (mode === 'spinning') {
    const damping = reducedMotion ? REDUCED_FRICTION : FRICTION;
    const ballDamping = reducedMotion ? REDUCED_BALL_FRICTION : BALL_FRICTION;
    const nextVelocity = angularVelocity * Math.exp(-damping * elapsed);
    const nextPosition = angularPosition + nextVelocity * elapsed;
    angularVelocity = nextVelocity;
    ballAngularVelocity *= Math.exp(-ballDamping * elapsed);
    ballAngularPosition += ballAngularVelocity * elapsed;
    applyPosition(nextPosition);
    renderBallPosition();

    if (Math.abs(angularVelocity) <= STOP_THRESHOLD) {
      angularVelocity = 0;
      beginSnap();
    }
  } else if (mode === 'snapping') {
    updateSnap(elapsed);
  }

  if (mode === 'spinning' || mode === 'snapping') {
    beginAnimation();
  }
}

function beginSpin(initialVelocity: number): void {
  ensureAudio();
  stopAnimation();
  resetTickTracking();
  angularVelocity = clamp(initialVelocity, -MAX_VELOCITY, MAX_VELOCITY);
  if (reducedMotion) {
    angularVelocity = clamp(angularVelocity, -REDUCED_MAX_VELOCITY, REDUCED_MAX_VELOCITY);
  }
  if (Math.abs(angularVelocity) < STOP_THRESHOLD) {
    angularVelocity = angularVelocity < 0 ? -STOP_THRESHOLD : STOP_THRESHOLD;
  }
  const ballDirection = angularVelocity > 0 ? -1 : 1;
  const ballSpeed = clamp(
    Math.abs(angularVelocity) * 1.15 + BALL_MIN_VELOCITY,
    BALL_MIN_VELOCITY,
    BALL_MAX_VELOCITY
  );
  ballAngularVelocity = ballDirection * (reducedMotion ? ballSpeed * 0.72 : ballSpeed);
  setMode('spinning');
  mechanicalNoteElement.textContent = '小球正在沿外圈减速';
  beginAnimation();
}

function getPointerAngle(event: PointerEvent): number {
  const rect = wheelStageElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(event.clientX - centerX, -(event.clientY - centerY));
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') {
    return;
  }

  event.preventDefault();
  ensureAudio();
  stopAnimation();
  angularVelocity = 0;
  ballAngularVelocity = 0;
  pointerId = event.pointerId;
  lastPointerAngle = getPointerAngle(event);
  dragStartPosition = angularPosition;
  dragTravel = 0;
  dragSamples = [{ position: 0, time: performance.now() }];
  resetTickTracking();
  wheelElement.setPointerCapture?.(event.pointerId);
  setMode('dragging');
  mechanicalNoteElement.textContent = '松手后让它自己停下';
}

function moveDrag(event: PointerEvent): void {
  if (mode !== 'dragging' || pointerId !== event.pointerId || lastPointerAngle === null) {
    return;
  }

  event.preventDefault();
  const nextPointerAngle = getPointerAngle(event);
  const delta = shortestAngleDelta(nextPointerAngle, lastPointerAngle);
  lastPointerAngle = nextPointerAngle;
  dragTravel += delta;
  applyPosition(dragStartPosition + dragTravel);
  ballAngularPosition = normalizeAngle(ballAngularPosition - delta * 0.65);
  renderBallPosition();

  const now = performance.now();
  dragSamples.push({ position: dragTravel, time: now });
  trimSamples(now);
}

function endDrag(event: PointerEvent): void {
  if (pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const now = performance.now();
  trimSamples(now);
  const firstSample = dragSamples[0];
  const lastSample = dragSamples[dragSamples.length - 1];
  const sampleSeconds = firstSample && lastSample ? (lastSample.time - firstSample.time) / 1000 : 0;
  const sampleVelocity =
    firstSample && lastSample && sampleSeconds > 0.01
      ? (lastSample.position - firstSample.position) / sampleSeconds
      : 0;

  pointerId = null;
  lastPointerAngle = null;
  dragSamples = [];
  try {
    wheelElement.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture may already be released by pointercancel.
  }

  if (Math.abs(sampleVelocity) > STOP_THRESHOLD) {
    beginSpin(sampleVelocity);
  } else {
    beginSnap();
    beginAnimation();
  }
}

function handleSpinButton(): void {
  const direction = Math.random() > 0.5 ? 1 : -1;
  const minimum = reducedMotion ? 6 : 8.5;
  const range = reducedMotion ? 4 : 6.5;
  beginSpin(direction * (minimum + Math.random() * range));
}

function handleSoundButton(): void {
  soundEnabled = !soundEnabled;
  soundButtonElement.setAttribute('aria-pressed', String(soundEnabled));
  soundStateElement.textContent = soundEnabled ? '开' : '关';
  if (soundEnabled) {
    ensureAudio();
    mechanicalNoteElement.textContent = '声音反馈已开启';
  } else {
    mechanicalNoteElement.textContent = '声音反馈已关闭';
  }
}

function handleKeyboard(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stopAnimation();
    angularVelocity = 0;
    resetTickTracking();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const target = getNearestSnapTarget(angularPosition) + direction * STEP;
    ballAngularVelocity = -direction * 2;
    ballAngularPosition = normalizeAngle(ballAngularPosition - direction * STEP * 1.5);
    renderBallPosition();
    beginSnap(target);
    beginAnimation();
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    handleSpinButton();
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    stopAnimation();
  } else {
    previousFrameTime = performance.now();
    if (mode === 'spinning' || mode === 'snapping') {
      beginAnimation();
    }
  }
}

function setupWheelMarks(): void {
  for (let index = 0; index < COUNT; index += 1) {
    const angle = index * STEP;
    const angleDegrees = (angle * 180) / Math.PI;
    const tickRadius = 42;
    const numberRadius = 34;
    const tick = document.createElement('span');
    tick.className = `tick${index % 5 === 0 ? ' is-major' : ''}`;
    tick.style.left = `${50 + Math.sin(angle) * tickRadius}%`;
    tick.style.top = `${50 - Math.cos(angle) * tickRadius}%`;
    tick.style.transform = `translate(-50%, -50%) rotate(${angleDegrees}deg)`;
    tickLayerElement.append(tick);
    tickElements.push(tick);

    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = String(index + 1);
    number.style.left = `${50 + Math.sin(angle) * numberRadius}%`;
    number.style.top = `${50 - Math.cos(angle) * numberRadius}%`;
    number.style.transform = `translate(-50%, -50%) rotate(${angleDegrees}deg)`;
    numberLayerElement.append(number);
  }
}

wheelElement.addEventListener('pointerdown', startDrag);
wheelElement.addEventListener('pointermove', moveDrag);
wheelElement.addEventListener('pointerup', endDrag);
wheelElement.addEventListener('pointercancel', endDrag);
wheelElement.addEventListener('lostpointercapture', () => {
  if (pointerId !== null) {
    pointerId = null;
    lastPointerAngle = null;
    if (mode === 'dragging') {
      beginSnap();
      beginAnimation();
    }
  }
});
wheelElement.addEventListener('keydown', handleKeyboard);
spinButtonElement.addEventListener('click', handleSpinButton);
soundButtonElement.addEventListener('click', handleSoundButton);
document.addEventListener('visibilitychange', handleVisibilityChange);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
reducedMotionQuery.addEventListener?.('change', (event) => {
  reducedMotion = event.matches;
});

setupWheelMarks();
renderPosition();
renderBallPosition();
setResult(1);
