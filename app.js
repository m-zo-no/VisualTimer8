"use strict";

// ==================================================
// 基本設定
// ==================================================

const MAX_SLOTS = 5;
const MAX_MINUTES = 60;
const MAX_LABEL_LENGTH = 12;

const MINUTE_MS = 60_000;
const RESET_HOLD_MS = 600;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const KEY_LABELS = ["Z", "C / X", "V", "B", "N"];

const DEFAULT_ACTIVITIES = [
  {
    label: "どくしょ",
    color: "#4696ff",
    textColor: "#fff500"
  },
  {
    label: "どうが",
    color: "#ff646e",
    textColor: "#ffffff"
  },
  {
    label: "べんきょう",
    color: "#4bbe78",
    textColor: "#ffffff"
  },
  {
    label: "きゅうけい",
    color: "#ffaf41",
    textColor: "#25252a"
  },
  {
    label: "あそび",
    color: "#aa73eb",
    textColor: "#ffffff"
  }
];

const BLACK = "#25252a";
const WHITE = "#ffffff";

const FONT_FAMILY = [
  "-apple-system",
  "BlinkMacSystemFont",
  '"Hiragino Sans"',
  '"Yu Gothic"',
  "Meiryo",
  "sans-serif"
].join(", ");

const $ = (id) => document.getElementById(id);

const ui = {
  viewport: $("viewport"),
  app: $("app"),

  clockArea: $("clockArea"),
  canvas: $("clockCanvas"),
  title: $("statusTitle"),
  description: $("statusDescription"),
  clockInfo: $("clockInfo"),

  inputStart: $("inputStartButton"),
  play: $("playButton"),
  reset: $("resetButton"),

  addSlot: $("addSlotButton"),
  removeSlot: $("removeSlotButton"),
  slotCount: $("slotCountText"),
  rows: $("activityRows"),
  total: $("totalText"),

  date: $("selectedDateText"),
  addDay: $("addDayButton"),
  hour: $("hourButton"),
  minute: $("minuteButton"),

  reserve: $("reserveButton"),
  cancelReserve: $("cancelReserveButton"),

  message: $("message"),
  deviceNow: $("deviceNowText"),
  reservationStatus: $("reservationStatus"),
  wakeStatus: $("wakeStatus"),
  sound: $("soundButton"),

  dialog: $("timeDialog"),
  pickerTitle: $("pickerTitle"),
  pickerDescription: $("pickerDescription"),
  pickerGrid: $("pickerGrid"),
  pickerClose: $("pickerCloseButton")
};

const ctx = ui.canvas.getContext("2d");


// ==================================================
// 状態
// ==================================================

const initialStart = new Date(Date.now() + 5 * MINUTE_MS);
initialStart.setSeconds(0, 0);

const state = {
  // live / stopped / waiting / play / finished
  mode: "live",

  activities: DEFAULT_ACTIVITIES.map((item) => ({ ...item })),
  slotCount: 2,

  // 各区間：{ slot, duration }
  segments: [],
  totalMinutes: 0,

  baseTime: null,
  displayTime: new Date(),

  elapsedMinutes: 0,
  elapsedSeconds: 0,
  startedAtMs: null,

  selectedStart: initialStart,
  scheduledStart: null,

  lastAddedSlot: null,
  fanfarePlayed: false,
  finishPlayed: false,

  picker: null,

  message:
    "活動の「＋1分」→ 下で時・分を選択 →「この日時で予約する」",
  messageKind: ""
};

const rowElements = [];

let uiDirty = true;
let lastUiSecond = -1;


// ==================================================
// 共通処理
// ==================================================

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return (
    `${date.getFullYear()}/` +
    `${pad2(date.getMonth() + 1)}/` +
    `${pad2(date.getDate())}`
  );
}

function formatTime(date, seconds = false) {
  const text =
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  return seconds
    ? `${text}:${pad2(date.getSeconds())}`
    : text;
}

function formatShortDateTime(date) {
  return (
    `${pad2(date.getMonth() + 1)}/` +
    `${pad2(date.getDate())} ${formatTime(date)}`
  );
}

function formatCountdown(milliseconds) {
  let seconds = Math.max(0, Math.ceil(milliseconds / 1000));

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const text =
    `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;

  return days ? `${days}日 ${text}` : text;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

function nextWholeMinute(date) {
  return new Date(
    Math.ceil(date.getTime() / MINUTE_MS) * MINUTE_MS
  );
}

function editable() {
  return state.mode === "live" || state.mode === "stopped";
}

function setText(element, text) {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function setMessage(text, kind = "") {
  state.message = text;
  state.messageKind = kind;
  uiDirty = true;
}

function finishInput() {
  const active = document.activeElement;

  if (active && active.matches(".activity-name")) {
    active.blur();
  }
}

function limitLabel(value) {
  return Array.from(value)
    .filter((character) => !/[\u0000-\u001f\u007f]/.test(character))
    .slice(0, MAX_LABEL_LENGTH)
    .join("");
}


// ==================================================
// 効果音
// ==================================================

const SOUND_PATTERNS = {
  plus: [
    [1000, 0.06, 0.12],
    [1400, 0.05, 0.10]
  ],
  minus: [
    [700, 0.06, 0.11],
    [500, 0.06, 0.09]
  ],
  enter: [
    [520, 0.08, 0.11],
    [390, 0.05, 0.09]
  ],
  start: [
    [440, 0.10, 0.11],
    [660, 0.10, 0.11],
    [880, 0.16, 0.13]
  ],
  fanfare: [
    [523, 0.12, 0.12],
    [659, 0.12, 0.12],
    [784, 0.12, 0.12],
    [1046, 0.28, 0.14],
    [0, 0.04, 0],
    [784, 0.10, 0.10],
    [1046, 0.28, 0.14]
  ],
  finish: [
    [880, 0.12, 0.12],
    [660, 0.12, 0.11],
    [440, 0.18, 0.11],
    [330, 0.28, 0.10]
  ]
};

let audioContext = null;
let audioWanted = true;
let soundGeneration = 0;

const activeOscillators = new Set();

function refreshSoundButton() {
  const enabled =
    audioWanted &&
    audioContext &&
    audioContext.state === "running";

  setText(
    ui.sound,
    enabled
      ? "音：オン"
      : audioWanted
        ? "音を有効にする"
        : "音：オフ"
  );

  ui.sound.setAttribute("aria-pressed", String(Boolean(enabled)));
}

function unlockAudio() {
  if (!audioWanted) {
    return Promise.resolve(false);
  }

  const AudioClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioClass) {
    setText(ui.sound, "音声非対応");
    ui.sound.disabled = true;
    return Promise.resolve(false);
  }

  try {
    if (!audioContext) {
      audioContext = new AudioClass();
      audioContext.addEventListener(
        "statechange",
        refreshSoundButton
      );
    }

    const promise =
      audioContext.state === "running"
        ? Promise.resolve()
        : audioContext.resume();

    return promise
      .then(() => {
        refreshSoundButton();
        return audioContext.state === "running";
      })
      .catch(() => {
        refreshSoundButton();
        return false;
      });
  } catch {
    return Promise.resolve(false);
  }
}

function stopSounds() {
  soundGeneration += 1;

  for (const oscillator of activeOscillators) {
    try {
      oscillator.stop();
    } catch {
      // 停止済みの場合は何もしません。
    }
  }

  activeOscillators.clear();
}

async function playSound(name) {
  if (!audioWanted || !SOUND_PATTERNS[name]) {
    return;
  }

  const generation = soundGeneration;
  const available = await unlockAudio();

  if (
    !available ||
    !audioWanted ||
    generation !== soundGeneration
  ) {
    return;
  }

  let cursor = audioContext.currentTime + 0.015;

  for (const [frequency, duration, volume] of SOUND_PATTERNS[name]) {
    if (frequency > 0) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, cursor);

      const fade = Math.min(0.02, duration / 3);

      gain.gain.setValueAtTime(0, cursor);
      gain.gain.linearRampToValueAtTime(volume, cursor + fade);
      gain.gain.setValueAtTime(volume, cursor + duration - fade);
      gain.gain.linearRampToValueAtTime(0, cursor + duration);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      activeOscillators.add(oscillator);

      oscillator.onended = () => {
        activeOscillators.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };

      oscillator.start(cursor);
      oscillator.stop(cursor + duration + 0.01);
    }

    cursor += duration;
  }
}


// ==================================================
// 自動消灯防止
// 対応ブラウザー・HTTPSなどの条件が必要です。
// ==================================================

let wakeLock = null;
let wakePending = false;

function needsWakeLock() {
  return state.mode === "waiting" || state.mode === "play";
}

async function updateWakeLock() {
  const needed =
    needsWakeLock() &&
    document.visibilityState === "visible";

  if (!needed) {
    if (wakeLock) {
      const lock = wakeLock;
      wakeLock = null;

      try {
        await lock.release();
      } catch {
        // 解放済みの場合は無視します。
      }
    }

    if (!needsWakeLock()) {
      setText(ui.wakeStatus, "");
    }

    return;
  }

  if (!("wakeLock" in navigator)) {
    setText(ui.wakeStatus, "自動消灯防止：非対応");
    return;
  }

  if (wakeLock || wakePending) {
    return;
  }

  wakePending = true;

  try {
    const lock = await navigator.wakeLock.request("screen");

    if (
      !needsWakeLock() ||
      document.visibilityState !== "visible"
    ) {
      await lock.release();
      return;
    }

    wakeLock = lock;
    setText(ui.wakeStatus, "自動消灯防止：有効");

    lock.addEventListener("release", () => {
      if (wakeLock === lock) {
        wakeLock = null;

        if (needsWakeLock()) {
          setText(ui.wakeStatus, "自動消灯防止：解除");
        }
      }
    });
  } catch {
    setText(ui.wakeStatus, "自動消灯防止：利用不可");
  } finally {
    wakePending = false;
  }
}


// ==================================================
// キー状態
// ==================================================

const heldResetKeys = new Set();
const pendingAddKeys = new Set();

let resetBlocked = false;
let resetStartedAt = null;
let resetTriggered = false;

function clearKeyTracking() {
  heldResetKeys.clear();
  pendingAddKeys.clear();

  resetBlocked = false;
  resetStartedAt = null;
  resetTriggered = false;
}

function isTypingTarget(target) {
  return (
    target instanceof Element &&
    (
      target.matches("input, textarea, select") ||
      target.isContentEditable
    )
  );
}


// ==================================================
// 活動入力欄
// ==================================================

function buildActivityRows() {
  for (let index = 0; index < MAX_SLOTS; index += 1) {
    const row = document.createElement("div");
    row.className = "activity-row";

    row.innerHTML = `
      <div class="activity-row-heading">
        <span class="activity-slot-name">
          <span class="color-dot" aria-hidden="true"></span>
          <span>枠 ${index + 1}</span>
        </span>

        <span class="activity-key">
          追加キー：${KEY_LABELS[index]}
        </span>
      </div>

      <input
        class="activity-name"
        type="text"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="done"
        aria-label="枠${index + 1}の活動名"
      >

      <button
        class="button button-red minus-button"
        type="button"
        aria-label="枠${index + 1}を1分減らす"
      >
        −1分
      </button>

      <button
        class="button button-blue plus-button"
        type="button"
        aria-label="枠${index + 1}に1分追加する"
      >
        ＋1分
      </button>

      <p class="activity-summary"></p>
    `;

    const input = row.querySelector(".activity-name");
    const minus = row.querySelector(".minus-button");
    const plus = row.querySelector(".plus-button");
    const summary = row.querySelector(".activity-summary");

    row.querySelector(".color-dot").style.backgroundColor =
      state.activities[index].color;

    input.value = state.activities[index].label;

    let composing = false;
    let originalLabel = input.value;

    function saveInput(final = false) {
      if (composing) {
        return;
      }

      const limited = limitLabel(input.value);

      if (input.value !== limited) {
        input.value = limited;
      }

      const trimmed = limited.trim();

      if (trimmed) {
        state.activities[index].label = trimmed;
      }

      if (final) {
        input.value = state.activities[index].label;
      }

      uiDirty = true;
    }

    input.addEventListener("focus", () => {
      clearKeyTracking();
      originalLabel = state.activities[index].label;
    });

    input.addEventListener("compositionstart", () => {
      composing = true;
    });

    input.addEventListener("compositionend", () => {
      composing = false;
      saveInput(document.activeElement !== input);
    });

    input.addEventListener("input", () => saveInput(false));
    input.addEventListener("blur", () => saveInput(true));

    input.addEventListener("keydown", (event) => {
      if (
        composing ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();

        state.activities[index].label = originalLabel;
        input.value = originalLabel;
        input.blur();

        uiDirty = true;
      }
    });

    minus.addEventListener("click", () => removeOneMinute(index));
    plus.addEventListener("click", () => addOneMinute(index));

    rowElements.push({
      row,
      input,
      minus,
      plus,
      summary
    });

    ui.rows.appendChild(row);
  }
}


// ==================================================
// 区間の計算
// ==================================================

function getRanges() {
  let cursor = 0;

  return state.segments.map((segment) => {
    const start = cursor;
    cursor += segment.duration;

    return {
      slot: segment.slot,
      start,
      end: cursor
    };
  });
}

function getVisibleSegments() {
  if (state.mode === "live" || !state.baseTime) {
    return [];
  }

  const cut =
    state.mode === "play" || state.mode === "finished"
      ? state.elapsedMinutes
      : 0;

  return getRanges()
    .map((segment) => {
      const start = Math.max(segment.start, cut);

      return {
        slot: segment.slot,
        start,
        end: segment.end,
        remaining: segment.end - start
      };
    })
    .filter((segment) => segment.remaining > 0);
}

function getActivityTotal(index) {
  return state.segments.reduce(
    (sum, segment) =>
      sum + (segment.slot === index ? segment.duration : 0),
    0
  );
}

function getActivityRemaining(index) {
  return getVisibleSegments().reduce(
    (sum, segment) =>
      sum + (segment.slot === index ? segment.remaining : 0),
    0
  );
}

function mergeSegments() {
  const result = [];

  for (const segment of state.segments) {
    if (segment.duration <= 0) {
      continue;
    }

    const previous = result[result.length - 1];

    if (previous && previous.slot === segment.slot) {
      previous.duration += segment.duration;
    } else {
      result.push({ ...segment });
    }
  }

  state.segments = result;
}


// ==================================================
// 設定開始・リセット
// ==================================================

function stopClock() {
  if (state.mode !== "live") {
    return;
  }

  finishInput();
  clearKeyTracking();

  state.mode = "stopped";
  state.baseTime = nextWholeMinute(new Date());
  state.displayTime = new Date(state.baseTime);

  state.segments = [];
  state.totalMinutes = 0;
  state.elapsedMinutes = 0;
  state.elapsedSeconds = 0;
  state.startedAtMs = null;

  state.lastAddedSlot = null;
  state.fanfarePlayed = false;
  state.finishPlayed = false;
  state.scheduledStart = null;

  setMessage(
    "活動の「＋1分」で時間を追加してください。「−1分」で減らせます。"
  );

  playSound("enter");
  updateWakeLock();
}

function resetToLive() {
  finishInput();
  closeTimePicker();
  clearKeyTracking();
  stopSounds();

  state.mode = "live";
  state.baseTime = null;
  state.displayTime = new Date();

  state.segments = [];
  state.totalMinutes = 0;
  state.elapsedMinutes = 0;
  state.elapsedSeconds = 0;
  state.startedAtMs = null;

  state.lastAddedSlot = null;
  state.fanfarePlayed = false;
  state.finishPlayed = false;
  state.scheduledStart = null;

  setMessage(
    "リセットしました。活動の「＋1分」から設定できます。"
  );

  updateWakeLock();
}


// ==================================================
// 活動の＋1分・−1分
// ==================================================

function addOneMinute(index) {
  if (
    !editable() ||
    index < 0 ||
    index >= state.slotCount
  ) {
    return;
  }

  finishInput();

  if (state.mode === "live") {
    stopClock();
  }

  if (state.totalMinutes >= MAX_MINUTES) {
    setMessage("合計時間は60分までです。", "error");
    return;
  }

  if (
    state.lastAddedSlot !== null &&
    state.lastAddedSlot !== index &&
    !state.fanfarePlayed
  ) {
    state.fanfarePlayed = true;
    playSound("fanfare");
  }

  const previous = state.segments[state.segments.length - 1];

  if (previous && previous.slot === index) {
    previous.duration += 1;
  } else {
    state.segments.push({
      slot: index,
      duration: 1
    });
  }

  state.totalMinutes += 1;
  state.lastAddedSlot = index;

  state.displayTime = addMinutes(
    state.baseTime,
    state.totalMinutes
  );

  playSound("plus");

  setMessage(
    `合計${state.totalMinutes}分。下で日時を選んで予約するか、` +
    "「今すぐスタート」を押してください。"
  );
}

function removeOneMinute(index) {
  if (
    state.mode !== "stopped" ||
    index < 0 ||
    index >= state.slotCount
  ) {
    return;
  }

  finishInput();

  for (let i = state.segments.length - 1; i >= 0; i -= 1) {
    if (state.segments[i].slot !== index) {
      continue;
    }

    state.segments[i].duration -= 1;
    state.totalMinutes -= 1;

    mergeSegments();

    const last = state.segments[state.segments.length - 1];
    state.lastAddedSlot = last ? last.slot : null;

    state.displayTime = addMinutes(
      state.baseTime,
      state.totalMinutes
    );

    playSound("minus");

    setMessage(
      `「${state.activities[index].label}」の最後から1分減らしました。` +
      `合計${state.totalMinutes}分です。`
    );

    return;
  }
}


// ==================================================
// 予約日時の選択
// ==================================================

function notifyScheduleChanged() {
  setMessage(
    `開始予定：${formatDate(state.selectedStart)} ` +
    `${formatTime(state.selectedStart)}。` +
    "最後に「この日時で予約する」を押してください。"
  );
}

function addScheduleDay() {
  if (!editable()) {
    return;
  }

  finishInput();

  const date = new Date(state.selectedStart);
  date.setDate(date.getDate() + 1);

  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() > 9999
  ) {
    setMessage("これ以上日付を進められません。", "error");
    return;
  }

  state.selectedStart = date;
  notifyScheduleChanged();
}

function openTimePicker(kind) {
  if (!editable() || ui.dialog.open) {
    return;
  }

  finishInput();
  clearKeyTracking();

  state.picker = kind;

  const isHour = kind === "hour";
  const count = isHour ? 24 : 60;

  const selected = isHour
    ? state.selectedStart.getHours()
    : state.selectedStart.getMinutes();

  setText(
    ui.pickerTitle,
    isHour ? "時を選んでください" : "分を選んでください"
  );

  setText(
    ui.pickerDescription,
    isHour
      ? "24時間表記です。午後1時は「13」、午後3時は「15」です。"
      : "00〜59の数字から選んでください。"
  );

  ui.pickerGrid.className =
    `picker-grid ${isHour ? "hours" : "minutes"}`;

  ui.pickerGrid.replaceChildren();

  const fragment = document.createDocumentFragment();

  for (let value = 0; value < count; value += 1) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "button " +
      (value === selected ? "button-green" : "button-blue");

    button.textContent = isHour ? `${value}時` : pad2(value);

    button.setAttribute(
      "aria-label",
      isHour ? `${value}時` : `${value}分`
    );

    button.setAttribute(
      "aria-pressed",
      String(value === selected)
    );

    button.addEventListener("click", () => {
      selectTimeValue(value);
    });

    fragment.appendChild(button);
  }

  ui.pickerGrid.appendChild(fragment);
  ui.dialog.showModal();
  ui.dialog.scrollTop = 0;
}

function closeTimePicker() {
  if (ui.dialog.open) {
    ui.dialog.close();
  }

  state.picker = null;
  clearKeyTracking();
}

function selectTimeValue(value) {
  if (!editable() || !state.picker) {
    closeTimePicker();
    return;
  }

  const date = new Date(state.selectedStart);

  if (state.picker === "hour") {
    date.setHours(value);
  } else {
    date.setMinutes(value);
  }

  date.setSeconds(0, 0);
  state.selectedStart = date;

  closeTimePicker();
  notifyScheduleChanged();
}


// ==================================================
// 予約の確定・解除
// ==================================================

function reserveStart() {
  if (!editable()) {
    return;
  }

  finishInput();

  if (state.totalMinutes <= 0) {
    setMessage(
      "活動時間が0分です。活動の「＋1分」を押してください。",
      "error"
    );
    return;
  }

  if (state.selectedStart.getTime() <= Date.now()) {
    setMessage(
      "開始日時が過去です。時・分を選び直すか、「＋1日」で日付を進めてください。",
      "error"
    );
    return;
  }

  const finishAt = addMinutes(
    state.selectedStart,
    state.totalMinutes
  );

  if (
    !Number.isFinite(finishAt.getTime()) ||
    finishAt.getFullYear() > 9999
  ) {
    setMessage("終了日時を計算できません。", "error");
    return;
  }

  clearKeyTracking();

  state.scheduledStart = new Date(state.selectedStart);
  state.baseTime = new Date(state.scheduledStart);
  state.displayTime = new Date(state.baseTime);
  state.mode = "waiting";

  stopSounds();
  playSound("enter");

  setMessage(
    `予約完了：${formatShortDateTime(state.scheduledStart)} 開始 → ` +
    `${formatShortDateTime(finishAt)} 終了予定。ページを表示したままお待ちください。`,
    "success"
  );

  updateWakeLock();
}

function cancelReservation() {
  if (state.mode !== "waiting") {
    return;
  }

  state.mode = "stopped";
  state.scheduledStart = null;

  state.baseTime = nextWholeMinute(new Date());
  state.displayTime = addMinutes(
    state.baseTime,
    state.totalMinutes
  );

  clearKeyTracking();

  setMessage(
    "予約を解除しました。活動時間や日時を変更して再予約できます。"
  );

  updateWakeLock();
}


// ==================================================
// 実行・経過時間
// ==================================================

function startPlayback(automatic = false, nowMs = Date.now()) {
  if (automatic) {
    if (state.mode !== "waiting" || !state.scheduledStart) {
      return;
    }
  } else {
    if (!editable()) {
      return;
    }

    if (state.totalMinutes <= 0) {
      setMessage(
        "先に活動の「＋1分」で時間を設定してください。",
        "error"
      );
      return;
    }
  }

  if (!state.baseTime || state.totalMinutes <= 0) {
    return;
  }

  finishInput();
  clearKeyTracking();

  if (automatic) {
    state.baseTime = new Date(state.scheduledStart);
    state.startedAtMs = state.scheduledStart.getTime();
  } else {
    /*
      手動開始の時計表示は元のPygame版と同様、
      設定時の時計基準を使います。
    */
    state.startedAtMs = nowMs;
  }

  state.mode = "play";
  state.elapsedMinutes = 0;
  state.elapsedSeconds = 0;
  state.finishPlayed = false;
  state.displayTime = new Date(state.baseTime);

  stopSounds();

  if (
    nowMs - state.startedAtMs <
    state.totalMinutes * MINUTE_MS
  ) {
    playSound("start");
  }

  setMessage(
    automatic
      ? "予約時刻になったため、自動スタートしました。"
      : "手動でスタートしました。",
    "success"
  );

  updatePlayback(nowMs);
  updateWakeLock();
}

function updatePlayback(nowMs) {
  if (
    state.mode !== "play" ||
    state.startedAtMs === null ||
    !state.baseTime
  ) {
    return;
  }

  const elapsedMs = Math.max(0, nowMs - state.startedAtMs);

  state.elapsedSeconds = Math.min(
    state.totalMinutes * 60,
    Math.floor(elapsedMs / 1000)
  );

  state.elapsedMinutes = Math.min(
    state.totalMinutes,
    Math.floor(elapsedMs / MINUTE_MS)
  );

  state.displayTime = addMinutes(
    state.baseTime,
    state.elapsedMinutes
  );

  if (state.elapsedMinutes >= state.totalMinutes) {
    state.mode = "finished";

    if (!state.finishPlayed) {
      state.finishPlayed = true;
      playSound("finish");
    }

    setMessage(
      "すべての活動が終了しました。「リセット」で次の設定を始められます。",
      "success"
    );

    updateWakeLock();
  }
}

function updateState(nowMs) {
  if (state.mode === "live") {
    state.displayTime = new Date(nowMs);
    return;
  }

  if (
    state.mode === "waiting" &&
    state.scheduledStart &&
    nowMs >= state.scheduledStart.getTime()
  ) {
    startPlayback(true, nowMs);
  }

  if (state.mode === "play") {
    updatePlayback(nowMs);
  }
}


// ==================================================
// キーボード操作
// ==================================================

function handleResetKeyDown(code) {
  heldResetKeys.add(code);

  if (
    heldResetKeys.has("KeyZ") &&
    heldResetKeys.has("KeyC")
  ) {
    resetBlocked = true;
    pendingAddKeys.clear();
  } else if (editable() && !resetBlocked) {
    pendingAddKeys.add(code);
  }
}

function handleResetKeyUp(code) {
  const shouldAdd =
    pendingAddKeys.has(code) &&
    !resetBlocked &&
    !state.picker &&
    !isTypingTarget(document.activeElement);

  pendingAddKeys.delete(code);
  heldResetKeys.delete(code);

  if (heldResetKeys.size === 0) {
    resetBlocked = false;
  }

  if (shouldAdd) {
    addOneMinute(code === "KeyZ" ? 0 : 1);
  }
}

function updateResetCombo(nowPerformance) {
  if (
    state.mode === "live" ||
    state.picker ||
    isTypingTarget(document.activeElement)
  ) {
    resetStartedAt = null;
    resetTriggered = false;
    return;
  }

  const bothPressed =
    heldResetKeys.has("KeyZ") &&
    heldResetKeys.has("KeyC");

  if (!bothPressed) {
    resetStartedAt = null;
    resetTriggered = false;
    return;
  }

  if (resetStartedAt === null) {
    resetStartedAt = nowPerformance;
  }

  if (
    nowPerformance - resetStartedAt >= RESET_HOLD_MS &&
    !resetTriggered
  ) {
    resetTriggered = true;
    resetToLive();
  }
}

function handleKeyDown(event) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    isTypingTarget(event.target) ||
    state.picker ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return;
  }

  const supported = [
    "Enter", "NumpadEnter", "Space",
    "KeyZ", "KeyC", "KeyX", "KeyV", "KeyB", "KeyN"
  ];

  if (!supported.includes(event.code)) {
    return;
  }

  // ボタンにフォーカスがある場合は標準の操作を優先。
  const onButton =
    event.target instanceof Element &&
    Boolean(event.target.closest("button"));

  if (
    onButton &&
    ["Enter", "NumpadEnter", "Space"].includes(event.code)
  ) {
    return;
  }

  event.preventDefault();

  if (event.repeat) {
    return;
  }

  switch (event.code) {
    case "Enter":
    case "NumpadEnter":
      stopClock();
      break;

    case "Space":
      startPlayback();
      break;

    case "KeyZ":
    case "KeyC":
      handleResetKeyDown(event.code);
      break;

    case "KeyX":
      addOneMinute(1);
      break;

    case "KeyV":
      addOneMinute(2);
      break;

    case "KeyB":
      addOneMinute(3);
      break;

    case "KeyN":
      addOneMinute(4);
      break;
  }
}


// ==================================================
// 時計描画
// ==================================================

const CLOCK_WIDTH = 780;
const CLOCK_HEIGHT = 650;

const CENTER_X = 390;
const CENTER_Y = 325;
const RADIUS = 310;

function resizeCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 3);

  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (
    ui.canvas.width !== width ||
    ui.canvas.height !== height
  ) {
    ui.canvas.width = width;
    ui.canvas.height = height;
  }

  drawClock();
}

function pointOnCircle(radius, angleDegrees) {
  const angle = (angleDegrees - 90) * Math.PI / 180;

  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle)
  };
}

function rangeToAngles(start, end) {
  const minute = state.baseTime.getMinutes();

  return {
    start: (minute + start) * 6,
    end: (minute + end) * 6
  };
}

function setFont(size, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function fillCircle(x, y, radius, color) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawLine(from, to, width, color = BLACK) {
  ctx.beginPath();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function outlinedText(
  text,
  point,
  size,
  color,
  outlineColor,
  outlineWidth = 2,
  rotation = 0
) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation * Math.PI / 180);

  setFont(size, 700);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.lineWidth = outlineWidth * 2;
  ctx.strokeStyle = outlineColor;
  ctx.fillStyle = color;

  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);

  ctx.restore();
}

function fitFont(text, maxWidth, initialSize, minimum = 12) {
  for (let size = initialSize; size >= minimum; size -= 1) {
    setFont(size, 700);

    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
  }

  return minimum;
}

function drawSector(segment) {
  const angles = rangeToAngles(segment.start, segment.end);

  ctx.beginPath();
  ctx.fillStyle = state.activities[segment.slot].color;

  if (angles.end - angles.start >= 360) {
    ctx.arc(
      CENTER_X,
      CENTER_Y,
      RADIUS - 15,
      0,
      Math.PI * 2
    );
  } else {
    ctx.moveTo(CENTER_X, CENTER_Y);

    ctx.arc(
      CENTER_X,
      CENTER_Y,
      RADIUS - 15,
      (angles.start - 90) * Math.PI / 180,
      (angles.end - 90) * Math.PI / 180
    );

    ctx.closePath();
  }

  ctx.fill();
}

function drawMarks() {
  ctx.lineCap = "butt";

  for (let index = 0; index < 60; index += 1) {
    const major = index % 5 === 0;
    const angle = index * 6;

    drawLine(
      pointOnCircle(RADIUS - (major ? 27 : 12), angle),
      pointOnCircle(RADIUS - 2, angle),
      major ? 4 : 2
    );
  }

  setFont(40, 400);
  ctx.fillStyle = BLACK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let number = 1; number <= 12; number += 1) {
    const point = pointOnCircle(RADIUS - 64, number * 30);
    ctx.fillText(String(number), point.x, point.y);
  }
}

function drawHands(date) {
  const seconds =
    date.getSeconds() + date.getMilliseconds() / 1000;

  const minutes = date.getMinutes() + seconds / 60;
  const hours = date.getHours() % 12 + minutes / 60;

  const center = {
    x: CENTER_X,
    y: CENTER_Y
  };

  ctx.save();
  ctx.lineCap = "round";

  drawLine(
    center,
    pointOnCircle(RADIUS - 155, hours * 30),
    12
  );

  drawLine(
    center,
    pointOnCircle(RADIUS - 75, minutes * 6),
    7
  );

  fillCircle(CENTER_X, CENTER_Y, 12, BLACK);
  ctx.restore();
}

function drawArcLabel(segment) {
  const activity = state.activities[segment.slot];
  const characters = Array.from(activity.label);

  if (characters.length === 0) {
    return;
  }

  const angles = rangeToAngles(segment.start, segment.end);
  const span = angles.end - angles.start;
  const middle = (angles.start + angles.end) / 2;

  const outline = activity.textColor === BLACK ? WHITE : BLACK;
  const textRadius = RADIUS - 115;

  const usableSpan = Math.min(150, Math.max(0, span - 4));
  const availableWidth = usableSpan * Math.PI / 180 * textRadius;
  const gap = 2;

  let selectedSize = null;
  let widths = [];
  let totalWidth = 0;

  for (let size = 36; size >= 17; size -= 1) {
    setFont(size, 700);

    const measured = characters.map(
      (character) => Math.max(1, ctx.measureText(character).width)
    );

    const width =
      measured.reduce((sum, value) => sum + value, 0) +
      gap * Math.max(0, characters.length - 1);

    if (width + 4 <= availableWidth) {
      selectedSize = size;
      widths = measured;
      totalWidth = width;
      break;
    }
  }

  if (selectedSize === null) {
    outlinedText(
      activity.label,
      pointOnCircle(RADIUS * 0.61, middle),
      fitFont(activity.label, 160, span < 18 ? 16 : 20),
      activity.textColor,
      outline
    );
    return;
  }

  const normalized = ((middle % 360) + 360) % 360;
  const lowerHalf = normalized > 90 && normalized < 270;
  const direction = lowerHalf ? -1 : 1;

  let cursor = -totalWidth / 2;

  characters.forEach((character, index) => {
    const width = widths[index];

    const offset =
      (cursor + width / 2) / textRadius * 180 / Math.PI;

    const angle = middle + direction * offset;

    outlinedText(
      character,
      pointOnCircle(textRadius, angle),
      selectedSize,
      activity.textColor,
      outline,
      2,
      angle + (lowerHalf ? 180 : 0)
    );

    cursor += width + gap;
  });
}

function drawRemainingNumber(segment) {
  const activity = state.activities[segment.slot];
  const angles = rangeToAngles(segment.start, segment.end);

  const span = angles.end - angles.start;
  const middle = (angles.start + angles.end) / 2;

  let size;
  let radius;
  let outlineWidth;

  if (span >= 24) {
    size = 76;
    radius = RADIUS * 0.34;
    outlineWidth = 3;
  } else if (span >= 12) {
    size = 46;
    radius = RADIUS * 0.39;
    outlineWidth = 2;
  } else {
    size = 28;
    radius = RADIUS * 0.44;
    outlineWidth = 2;
  }

  outlinedText(
    String(segment.remaining),
    pointOnCircle(radius, middle),
    size,
    activity.textColor,
    activity.textColor === BLACK ? WHITE : BLACK,
    outlineWidth
  );
}

function drawClock() {
  const width = ui.canvas.width;
  const height = ui.canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  /*
    描画領域の縦横比が変わっても、
    時計が楕円にならないよう同じ倍率を使います。
  */
  const scale = Math.min(
    width / CLOCK_WIDTH,
    height / CLOCK_HEIGHT
  );

  const offsetX = (width - CLOCK_WIDTH * scale) / 2;
  const offsetY = (height - CLOCK_HEIGHT * scale) / 2;

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  fillCircle(CENTER_X, CENTER_Y, RADIUS, WHITE);

  const visible = getVisibleSegments();

  for (const segment of visible) {
    drawSector(segment);
  }

  ctx.beginPath();
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 4;
  ctx.arc(CENTER_X, CENTER_Y, RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  drawMarks();
  drawHands(state.displayTime);

  for (const segment of visible) {
    drawArcLabel(segment);
    drawRemainingNumber(segment);
  }
}


// ==================================================
// 画面の文字・ボタン更新
// ==================================================

function renderUI(nowMs) {
  const canEdit = editable();
  const now = new Date(nowMs);

  let title;
  let description;

  switch (state.mode) {
    case "live":
      title = "現在時刻";
      description =
        "活動名を決めて、右側の「＋1分」で時間を設定";
      break;

    case "stopped":
      title = "活動時間を設定中";
      description =
        "「＋1分」「−1分」で調整。予約は下の日時から";
      break;

    case "waiting":
      title = "予約完了・開始待ち";
      description =
        "自動スタートまで " +
        formatCountdown(state.scheduledStart.getTime() - nowMs);
      break;

    case "play":
      title = "トレーニング中";
      description =
        `経過 ${Math.floor(state.elapsedSeconds / 60)}分` +
        `${pad2(state.elapsedSeconds % 60)}秒` +
        " ／ 時計と残り分数は1分ごとに更新";
      break;

    default:
      title = "すべての活動が終了しました";
      description = "「リセット」で次の設定を始められます";
  }

  setText(ui.title, title);
  setText(ui.description, description);

  ui.inputStart.disabled = state.mode !== "live";
  ui.play.disabled = !canEdit || state.totalMinutes <= 0;
  ui.reset.disabled = state.mode === "live";

  let clockInfo;

  if (state.mode === "live") {
    clockInfo =
      `現在時刻：${formatTime(state.displayTime, true)}`;
  } else if (state.mode === "waiting") {
    clockInfo =
      `予約：${formatShortDateTime(state.scheduledStart)}　` +
      `合計：${state.totalMinutes}分`;
  } else {
    clockInfo =
      `時計の基準：${formatTime(state.baseTime)}　` +
      `設定：${state.totalMinutes}分　経過：${state.elapsedMinutes}分`;
  }

  setText(ui.clockInfo, clockInfo);

  ui.canvas.setAttribute(
    "aria-label",
    `${title}。時計表示 ${formatTime(state.displayTime)}。` +
    `設定${state.totalMinutes}分、経過${state.elapsedMinutes}分。`
  );

  setText(ui.slotCount, `${state.slotCount} / ${MAX_SLOTS} 枠`);

  ui.addSlot.disabled =
    state.mode !== "live" || state.slotCount >= MAX_SLOTS;

  ui.removeSlot.disabled =
    state.mode !== "live" || state.slotCount <= 1;

  rowElements.forEach((elements, index) => {
    elements.row.hidden = index >= state.slotCount;
    elements.input.disabled = !canEdit;

    const total = getActivityTotal(index);
    const remaining = getActivityRemaining(index);

    elements.minus.disabled =
      state.mode !== "stopped" || total <= 0;

    elements.plus.disabled =
      !canEdit || state.totalMinutes >= MAX_MINUTES;

    setText(
      elements.summary,
      `設定 ${total} 分　 残り ${remaining} 分`
    );
  });

  setText(
    ui.total,
    `合計：${state.totalMinutes} / ${MAX_MINUTES} 分`
  );

  const selected = state.selectedStart;

  setText(
    ui.date,
    `開始日：${formatDate(selected)}（${WEEKDAYS[selected.getDay()]}）`
  );

  setText(ui.hour, `${selected.getHours()}時`);
  setText(ui.minute, `${pad2(selected.getMinutes())}分`);

  ui.addDay.disabled = !canEdit;
  ui.hour.disabled = !canEdit;
  ui.minute.disabled = !canEdit;

  ui.reserve.disabled = !canEdit;
  ui.cancelReserve.disabled = state.mode !== "waiting";

  setText(
    ui.reserve,
    state.mode === "waiting"
      ? "予約済み・開始待ち"
      : "この日時で予約する"
  );

  let reservationStatus;

  if (state.mode === "waiting") {
    reservationStatus =
      "開始まで " +
      formatCountdown(state.scheduledStart.getTime() - nowMs);
  } else if (state.mode === "play") {
    reservationStatus = "実行中";
  } else if (state.mode === "finished") {
    reservationStatus = "終了";
  } else {
    reservationStatus = "日時を選ぶだけでは予約されません";
  }

  setText(ui.reservationStatus, reservationStatus);

  setText(
    ui.deviceNow,
    `端末現在：${formatDate(now)} ${formatTime(now, true)}`
  );

  setText(ui.message, state.message);

  ui.message.className = state.messageKind
    ? `message is-${state.messageKind}`
    : "message";

  /*
    長い活動名などを含むメッセージも、
    フッターの幅内に収まるよう調整します。
  */
  ui.message.style.fontSize = "16px";

  let messageSize = 16;

  while (
    ui.message.scrollWidth > ui.message.clientWidth &&
    messageSize > 10
  ) {
    messageSize -= 1;
    ui.message.style.fontSize = `${messageSize}px`;
  }

  uiDirty = false;
}


// ==================================================
// ページ全体を画面に自動フィット
// ==================================================

let fitFrame = null;

function fitAppToViewport() {
  fitFrame = null;

  const style = getComputedStyle(ui.viewport);

  const leftPadding = parseFloat(style.paddingLeft) || 0;
  const rightPadding = parseFloat(style.paddingRight) || 0;
  const topPadding = parseFloat(style.paddingTop) || 0;
  const bottomPadding = parseFloat(style.paddingBottom) || 0;

  const availableWidth = Math.max(
    1,
    ui.viewport.clientWidth - leftPadding - rightPadding
  );

  const availableHeight = Math.max(
    1,
    ui.viewport.clientHeight - topPadding - bottomPadding
  );

  const appWidth = ui.app.offsetWidth;
  const appHeight = ui.app.offsetHeight;

  const scale = Math.min(
    availableWidth / appWidth,
    availableHeight / appHeight
  );

  const x =
    leftPadding + (availableWidth - appWidth * scale) / 2;

  const y =
    topPadding + (availableHeight - appHeight * scale) / 2;

  ui.app.style.transform =
    `translate(${x}px, ${y}px) scale(${scale})`;

  resizeCanvas();
}

function requestFit() {
  if (fitFrame !== null) {
    return;
  }

  fitFrame = requestAnimationFrame(fitAppToViewport);
}


// ==================================================
// イベント登録
// ==================================================

ui.inputStart.addEventListener("click", stopClock);

ui.play.addEventListener("click", () => {
  startPlayback(false);
});

ui.reset.addEventListener("click", resetToLive);

ui.addSlot.addEventListener("click", () => {
  if (state.mode !== "live" || state.slotCount >= MAX_SLOTS) {
    return;
  }

  finishInput();
  state.slotCount += 1;
  uiDirty = true;
});

ui.removeSlot.addEventListener("click", () => {
  if (state.mode !== "live" || state.slotCount <= 1) {
    return;
  }

  finishInput();
  state.slotCount -= 1;
  uiDirty = true;
});

ui.addDay.addEventListener("click", addScheduleDay);

ui.hour.addEventListener("click", () => {
  openTimePicker("hour");
});

ui.minute.addEventListener("click", () => {
  openTimePicker("minute");
});

ui.reserve.addEventListener("click", reserveStart);
ui.cancelReserve.addEventListener("click", cancelReservation);

ui.pickerClose.addEventListener("click", closeTimePicker);

ui.dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTimePicker();
});

ui.dialog.addEventListener("close", () => {
  state.picker = null;
  clearKeyTracking();
});

ui.dialog.addEventListener("click", (event) => {
  if (event.target !== ui.dialog) {
    return;
  }

  const rect = ui.dialog.getBoundingClientRect();

  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    closeTimePicker();
  }
});

// iPadの音声制限に対応するため、操作時に音声を準備。
document.addEventListener(
  "pointerdown",
  (event) => {
    const onSoundButton =
      event.target instanceof Element &&
      Boolean(event.target.closest("#soundButton"));

    if (!onSoundButton) {
      unlockAudio();
    }

    updateWakeLock();
  },
  { passive: true }
);

document.addEventListener("keydown", (event) => {
  const onSoundButton =
    event.target instanceof Element &&
    Boolean(event.target.closest("#soundButton"));

  if (!onSoundButton) {
    unlockAudio();
  }

  handleKeyDown(event);
});

document.addEventListener("keyup", (event) => {
  if (event.code === "KeyZ" || event.code === "KeyC") {
    handleResetKeyUp(event.code);
  }
});

ui.sound.addEventListener("click", async () => {
  const currentlyOn =
    audioWanted &&
    audioContext &&
    audioContext.state === "running";

  if (currentlyOn) {
    audioWanted = false;
    stopSounds();
    refreshSoundButton();
    return;
  }

  audioWanted = true;

  const available = await unlockAudio();

  if (available) {
    playSound("plus");
  } else {
    setMessage(
      "音声を有効にできませんでした。端末の設定を確認し、もう一度音のボタンを押してください。",
      "error"
    );
  }

  refreshSoundButton();
});

window.addEventListener("blur", clearKeyTracking);

document.addEventListener("visibilitychange", () => {
  clearKeyTracking();

  if (document.visibilityState === "visible") {
    const nowMs = Date.now();

    // 非表示中に過ぎた時間を反映します。
    updateState(nowMs);
    renderUI(nowMs);
    drawClock();

    requestFit();
  }

  updateWakeLock();
});

window.addEventListener("pageshow", () => {
  updateState(Date.now());
  uiDirty = true;

  requestFit();
  updateWakeLock();
});

window.addEventListener("pagehide", () => {
  clearKeyTracking();
  stopSounds();

  if (wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }
});

window.addEventListener("resize", requestFit);
window.addEventListener("orientationchange", requestFit);
window.addEventListener("load", requestFit);

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", requestFit);
}


// ==================================================
// 起動
// ==================================================

buildActivityRows();
refreshSoundButton();
renderUI(Date.now());
fitAppToViewport();

if ("ResizeObserver" in window) {
  const viewportObserver = new ResizeObserver(requestFit);
  viewportObserver.observe(ui.viewport);

  const canvasObserver = new ResizeObserver(resizeCanvas);
  canvasObserver.observe(ui.clockArea);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    uiDirty = true;
    requestFit();
  });
}


// ==================================================
// メインループ
// ==================================================

let lastDrawTime = -Infinity;

function animationLoop(nowPerformance) {
  const nowMs = Date.now();

  updateResetCombo(nowPerformance);
  updateState(nowMs);

  const currentSecond = Math.floor(nowMs / 1000);

  const needsRender =
    uiDirty || currentSecond !== lastUiSecond;

  if (needsRender) {
    renderUI(nowMs);
    lastUiSecond = currentSecond;
  }

  if (
    needsRender ||
    nowPerformance - lastDrawTime >= 1000 / 30
  ) {
    drawClock();
    lastDrawTime = nowPerformance;
  }

  requestAnimationFrame(animationLoop);
}

requestAnimationFrame(animationLoop);
