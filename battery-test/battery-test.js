let isTestRunning = false;
let testButtonEl = document.getElementById("test_btn");
let batteryLevelEl = document.getElementById("battery_level");
let batteryStatusEl = document.getElementById("battery_status");
let batteryTestDurationEl = document.getElementById("battery_test_dur");
let batteryAVGSpeedEl = document.getElementById("battery_avg_speed");

let timeFromLastUpdateEl = document.getElementById("time_from_last_update");
let batteryLastSpeedEl = document.getElementById("battery_last_speed");

let threadsCntEl = document.getElementById("threads_cnt");
let parallelThreads = 6;
let initialBatteryLevel = -1;//when the test started
let batteryLevelFromLastChange = 0;//when the test started
let testStartDateTime = new Date();
let lastBatteryChangeDateTime = new Date();
let testDuration;
let wakeLock = null;
let isDebug = true;

let workers = [];
let workerBlob = new Blob([
  document.querySelector('#worker1').textContent
], { type: "text/javascript" })

function startTest() {
  isTestRunning = !isTestRunning;
  //start high load to discharge battery quicker
  if (isTestRunning) {
    requestWakeLock();
    parallelThreads = threadsCntEl.value;
    console.log("start " + parallelThreads + " threads");
    initialBatteryLevel = batteryLevelEl.innerHTML.replaceAll("%", "");
    testStartDateTime = new Date();
    for (let i = 0; i < parallelThreads; i++) {
      //console.log("start thread #" + i);
      highLoad(i);
    }
    testButtonEl.innerHTML = "Stop test";
  } else {
    //console.log("terminate " + parallelThreads + " threads");
    for (let i = (workers.length - 1); i >=0; i--) {
      //console.log("terminate thread #" + i);
      workers[i].terminate();
      workers[i] = undefined;
      workers.splice(i, 1);
    }
    releaseWakeLock();
    testButtonEl.innerHTML = "Start test";
  }
}

navigator.getBattery().then((battery) => {
  updateAllBatteryInfo();

  battery.addEventListener("chargingchange", () => {
    updateBatteryStatus();
  });
  
  battery.addEventListener("levelchange", () => {
    updateBatteryInfo();
  });
  
  function updateAllBatteryInfo() {
    updateBatteryStatus();
    updateBatteryInfo();
  }
  function updateBatteryInfo() {
    //do all calculations
    let batteryLevelPercent = battery.level * 100.0;
    if (initialBatteryLevel == -1) {
      initialBatteryLevel = batteryLevelPercent;
    }
    
    let currentDateTime = new Date();
    let testDurationMS = currentDateTime - testStartDateTime;
    let testDurationMin = testDurationMS / 1000.0 / 60.0;
    let timeFromLastUpdateMS = currentDateTime - lastBatteryChangeDateTime;
    let timeFromLastUpdateMin = timeFromLastUpdateMS / 1000.0 / 60.0;
    
    let batteryLevelDiffFromTestStart = batteryLevelPercent - initialBatteryLevel;
    let batteryLevelDiffFromLastChange = batteryLevelPercent - batteryLevelFromLastChange;
    let batteryAVGSpeed = (batteryLevelDiffFromTestStart / testDurationMin).toFixed(3);
    let batteryLastSpeed = (batteryLevelDiffFromLastChange / timeFromLastUpdateMin).toFixed(3);
    
    //update all html elements
    batteryLevelEl.innerHTML = batteryLevelPercent + "%";
    batteryTestDurationEl.innerHTML = msToTime(testDurationMS) + " (" + testDurationMin.toFixed(3) + "min)";
    batteryAVGSpeedEl.innerHTML = (batteryAVGSpeed >= 0 ? ("+" + batteryAVGSpeed) : batteryAVGSpeed) + "%/min";
    
    timeFromLastUpdateEl.innerHTML = msToTime(timeFromLastUpdateMS) + " (" + timeFromLastUpdateMin.toFixed(3) + "min)";
    batteryLastSpeedEl.innerHTML = (batteryLastSpeed >= 0 ? ("+" + batteryLastSpeed) : batteryLastSpeed) + "%/min";
    //console.log(`Battery level: ${battery.level * 100}%`);
    
    batteryLevelFromLastChange = batteryLevelPercent;
    lastBatteryChangeDateTime = new Date();
  }
  function updateBatteryStatus() {
    batteryStatusEl.innerHTML = battery.charging ? "Charging" : "Discharging";
    //console.log(`Battery charging? ${battery.charging ? "Yes" : "No"}`);
  }

});

function highLoad(threadNumber) {
  // Note: window.webkitURL.createObjectURL() in Chrome 10+.
  let worker = new Worker(window.URL.createObjectURL(workerBlob));
  worker.onmessage = function(e) {
    //console.log("Received: " + e.data);
  }
  worker.postMessage(threadNumber); // Start the worker.
  workers.push(worker);
  //console.log("workers.length: " + workers.length);
  
  //console.log("load started [" + threadNumber + "]");
}

function randomIntFromInterval(min, max) { // min and max included 
  return Math.floor(Math.random() * (max - min + 1) + min)
}
  
function msToTime(duration) {
  // Calculate the number of days
  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const seconds = Math.floor((duration / 1000) % 60);

  // Format the components to be two digits using padStart
  const hoursFormatted = String(hours).padStart(2, '0');
  const minutesFormatted = String(minutes).padStart(2, '0');
  const secondsFormatted = String(seconds).padStart(2, '0');

  // Build the final human-readable string
  return `${days}d ${hoursFormatted}:${minutesFormatted}:${secondsFormatted}`;
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      logMsg('Wake Lock is active');
      wakeLock.addEventListener('release', () => {
        logMsg('Wake Lock was released');
        wakeLock = null;
      });
    } catch (err) {
      logMsg('Wake Lock request failed:', err.message);
      wakeLock = null;
    }
  } else {
    logMsg('Wake Lock API is not supported in this browser.');
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    try {
      await wakeLock.release();
      wakeLock = null;
      logMsg('Wake Lock released');
    } catch (err) {
      logMsg('Wake Lock release failed:', err.message);
    }
  }
}

function logMsg(msg, objectToLog = null, isError = false, forceDebug = false) {
  if ((isDebug) || (forceDebug)) {
    const currDate = getCurrDateAsString();
    if (objectToLog) {
      if (isError) {
        console.error(`[${currDate}] [ERROR] ${msg}`, objectToLog);
      } else {
        console.log(`[${currDate}] [DEBUG] ${msg}`, objectToLog);
      }
    } else {
      if (isError) {
        console.error(`[${currDate}] [ERROR] ${msg}`);
      } else {
        console.log(`[${currDate}] [DEBUG] ${msg}`);
      }
    }
  }
}

function getCurrDateAsString(isISO8601DateFormat = false) {
  const date = new Date();
  const year = date.getFullYear();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  if (isISO8601DateFormat) {
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  } else {
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
}
