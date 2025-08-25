(function () {
  "use strict";

  // ===== CONFIG =====
  const CONFIG = Object.freeze({
    limit: 100, // 出題上限（1〜limit）
    initialLives: 3, // 初期ライフ
    tickIntervalMs: 100, // 経過タイマーのUI更新間隔
    messageTypes: ["ok", "ng", "info"],
    lifeBonusEvery: 10, // ★ 何問正解ごとにライフ+1するか
    tweet: {
      hashtags: ["サンゴーファイト"],
      url: "https://motiontechweb.github.io/js-practice/Day02-fizzbuzz/index.html", // 共有したいURLがあれば設定（空なら付与しない）
    },
  });

  // ===== DOM =====
  function byId(id) {
    return document.getElementById(id);
  }
  const EL = {
    number: byId("number"),
    score: byId("score"),
    lives: byId("lives"),
    timer: byId("timer"),
    message: byId("message"),
    restartBtn: byId("restart"),
    tweetBtn: byId("tweetBtn"),
    buttons: document.querySelectorAll(".btn"),
  };

  // ===== STATE =====
  const STATE = {
    current: 1,
    score: 0,
    lives: CONFIG.initialLives,
    limit: CONFIG.limit,
    correctCount: 0, // ★ 累計正解数（ボーナス判定に使用）
  };
  let isOver = false;
  let isLocked = false; // 1問内の多重入力防止

  // ===== Global Timer（最初の回答から終了まで） =====
  let hasStarted = false; // 最初の回答が行われたか
  let startTs = 0; // performance.now() 基準
  let elapsedMs = 0; // 終了時の確定経過時間
  let tickId = null; // setInterval ID

  function resetGlobalTimerUI() {
    if (EL.timer) EL.timer.textContent = "0.0";
  }
  function startGlobalTimerIfNeeded() {
    if (hasStarted) return;
    hasStarted = true;
    startTs = performance.now();
    tickId = setInterval(() => {
      const now = performance.now();
      const ms = now - startTs;
      if (EL.timer) EL.timer.textContent = (ms / 1000).toFixed(1);
    }, CONFIG.tickIntervalMs);
  }
  function stopGlobalTimer() {
    if (tickId != null) {
      clearInterval(tickId);
      tickId = null;
    }
    if (hasStarted) {
      elapsedMs = performance.now() - startTs;
      if (EL.timer) EL.timer.textContent = (elapsedMs / 1000).toFixed(1);
    } else {
      elapsedMs = 0;
      resetGlobalTimerUI();
    }
  }

  // ===== Pure Logic =====
  function fizzBuzz(n) {
    let result = "";
    if (n % 3 === 0) result += "Fizz";
    if (n % 5 === 0) result += "Buzz";
    return result || n;
  }
  function correctLabel(n) {
    const c = fizzBuzz(n);
    return typeof c === "string" ? c.toLowerCase() : "number";
  }

  // ===== UI =====
  function render() {
    EL.number.textContent = STATE.current;
    EL.score.textContent = STATE.score;
    EL.lives.textContent = STATE.lives;
  }

  function showMessage(type, text) {
    CONFIG.messageTypes.forEach((t) => EL.message?.classList?.remove(t));
    if (type && CONFIG.messageTypes.includes(type)) {
      EL.message?.classList?.add(type);
    }
    if (EL.message) EL.message.textContent = text || "";
  }

  function setButtonsEnabled(enabled) {
    // 回答ボタンのみ対象（data-answer 保持）
    EL.buttons.forEach((btn) => {
      if (btn.dataset && btn.dataset.answer) btn.disabled = !enabled;
    });
    // restart / tweet は常時押せる設計（表示は終了時のみ）
  }

  function showQuestion() {
    EL.number.textContent = STATE.current;
  }

  function showTweetButton(show) {
    if (!EL.tweetBtn) return;
    EL.tweetBtn.style.display = show ? "" : "none";
  }

  function buildTweetURL() {
    const seconds = (elapsedMs / 1000).toFixed(1);
    const text = `スコア: ${STATE.score} / 経過: ${seconds}s`;
    const urlLine = CONFIG.tweet.url ? CONFIG.tweet.url : "";
    const hashtagsLine = CONFIG.tweet.hashtags?.length
      ? "#" + CONFIG.tweet.hashtags.join(" #")
      : "";

    // 改行込みで結合
    const body = [text, urlLine, hashtagsLine].filter(Boolean).join("\n");

    const params = new URLSearchParams();
    params.set("text", body);

    return `https://twitter.com/intent/tweet?${params.toString()}`;
  }

  // ===== Flow =====
  function init() {
    STATE.current = 1;
    STATE.score = 0;
    STATE.lives = CONFIG.initialLives;
    STATE.correctCount = 0; // ★ リセット
    isOver = false;
    isLocked = false;

    // タイマー初期化（まだスタートしない）
    hasStarted = false;
    startTs = 0;
    elapsedMs = 0;
    if (tickId) {
      clearInterval(tickId);
      tickId = null;
    }
    resetGlobalTimerUI();

    setButtonsEnabled(true);
    showTweetButton(false); // 終了時のみ表示
    showMessage("info", "");
    render();
    showQuestion();
  }

  function gameOver() {
    isOver = true;
    stopGlobalTimer(); // 経過時間を確定→UIに反映
    setButtonsEnabled(false);
    showMessage("ng", "Game Over");
    showTweetButton(true); // 終了時にTweet表示
  }

  function gameClear() {
    isOver = true;
    stopGlobalTimer();
    setButtonsEnabled(false);
    showMessage("ok", "Game Clear!");
    showTweetButton(true);
  }

  function proceedNextOrEnd() {
    STATE.current++;
    if (STATE.lives <= 0) {
      render();
      gameOver();
      return false;
    }
    if (STATE.current > STATE.limit) {
      render();
      gameClear();
      return false;
    }
    render();
    showQuestion();
    isLocked = false;
    setButtonsEnabled(true);
    return true;
  }

  function handleAnswer(userAnswer) {
    if (isOver || isLocked) return;
    // 最初の回答タイミングでグローバルタイマーを開始
    startGlobalTimerIfNeeded();

    isLocked = true;
    setButtonsEnabled(false);

    const isCorrect = userAnswer === correctLabel(STATE.current);

    if (isCorrect) {
      STATE.score++;
      STATE.correctCount++; // ★ 累計正解数をカウント

      // ★ ボーナス判定：正解が lifeBonusEvery の倍数に到達したらライフ+1
      let msg = "正解!";
      if (STATE.correctCount % CONFIG.lifeBonusEvery === 0) {
        STATE.lives++;
        msg += " ライフ+1!";
      }
      showMessage("ok", msg);
    } else {
      STATE.lives--;
      // 正解をカスタムメッセージに変換
      const correct = fizzBuzz(STATE.current);
      let correctMsg = "";
      if (correct === "Fizz") correctMsg = "サン！";
      else if (correct === "Buzz") correctMsg = "ゴー！";
      else if (correct === "FizzBuzz") correctMsg = "サンゴー！";
      else correctMsg = "虚無";

      showMessage("ng", `残念… (正解は ${correctMsg})`);

      if (STATE.lives <= 0) {
        render();
        gameOver();
        return;
      }
    }

    proceedNextOrEnd();
  }

  // ===== Events =====
  EL.buttons.forEach((btn) => {
    if (!btn.dataset.answer) return;
    btn.addEventListener("click", () => {
      handleAnswer(btn.dataset.answer); // "fizz"/"buzz"/"fizzbuzz"/"number"
    });
  });

  if (EL.restartBtn) {
    EL.restartBtn.addEventListener("click", () => {
      const ok = window.confirm("最初からやり直しますか？");
      if (!ok) return;
      init();
    });
  }

  if (EL.tweetBtn) {
    EL.tweetBtn.addEventListener("click", () => {
      const url = buildTweetURL();
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  // 起動
  init();
})();
