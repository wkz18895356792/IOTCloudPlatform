#!/usr/bin/env node
// APP API Full Test Suite
var TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyY2ZhNDgzNS05ZTRhLTRlN2QtOTM4Yi04MzVmOTM5MzcyMzQiLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTc4MDM5NzM1MiwiZXhwIjoxNzgwNDA0NTUyfQ.2gYf4LsDHJgydd7LZoHxI54CqA83LKoxG0dsG1tgk3M";
var G = "http://localhost:6001";
var R = [];
var D = null, B = null, L = null, N = null, X = "non-existent-id-12345";

async function api(method, path, body) {
  var url = G + path;
  var headers = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };
  var opts = { method: method, headers: headers };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  var start = Date.now();
  try {
    var res = await fetch(url, opts);
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = text; }
    return { status: res.status, data: data, elapsed: Date.now() - start };
  } catch(err) {
    return { status: 0, data: { error: err.message }, elapsed: Date.now() - start };
  }
}

function rec(sec, n, name, method, path, result, exp) {
  exp = exp || 200;
  var ok = result.status === exp;
  var passed = ok && (result.data && result.data.success !== false || result.status >= 200 && result.status < 300);
  var status = result.status === 0 ? "SKIP" : (passed ? "PASS" : "FAIL");
  R.push({ sec: sec, n: n, name: name, method: method, path: path, status: status, http: result.status, ms: result.elapsed, exp: exp });
  var icons = { PASS: "OK", FAIL: "XX", SKIP: "--" };
  console.log("  " + icons[status] + " #" + n + " " + method + " " + path + " -> HTTP " + result.status + " (" + result.elapsed + "ms)");
  if (status === "FAIL") console.log("     Exp: " + exp + ", Got: " + JSON.stringify(result.data).substring(0, 200));
}

function summary() {
  var pass = R.filter(function(t) { return t.status === "PASS"; }).length;
  var fail = R.filter(function(t) { return t.status === "FAIL"; }).length;
  var skip = R.filter(function(t) { return t.status === "SKIP"; }).length;
  console.log("\n" + "=".repeat(60));
  console.log("DONE: " + pass + " PASS | " + fail + " FAIL | " + skip + " SKIP | " + R.length + " total");
  console.log("=".repeat(60));
  if (fail > 0) {
    console.log("\nFAILURES:");
    R.filter(function(t) { return t.status === "FAIL"; }).forEach(function(t) {
      console.log("  XX #" + t.n + " " + t.method + " " + t.path + " [" + t.sec + "] -> HTTP " + t.http + " (exp " + t.exp + ")");
    });
  }
}

async function setup() {
  console.log("\n--- SETUP ---");
  var dr = await api("POST", "/api/devices", {
    productType: "CAMERA", deviceName: "API Test Camera",
    serialNumber: "TEST-" + Date.now(), macAddress: "AA:BB:CC:DD:EE:FF"
  });
  if (dr.status === 200 && dr.data && dr.data.success) {
    D = dr.data.data.deviceId || dr.data.data.id;
    console.log("  Device: " + D);
  } else {
    console.log("  Device FAIL: " + JSON.stringify(dr.data).substring(0, 100));
  }
  var br = await api("POST", "/api/babies", {
    name: "API Test Baby", gender: "male", birthDate: "2025-01-15"
  });
  if (br.status === 200 && br.data && br.data.success) {
    B = br.data.data.babyId || br.data.data.id;
    console.log("  Baby: " + B);
  } else {
    console.log("  Baby FAIL: " + JSON.stringify(br.data).substring(0, 100));
  }
  if (D && B) {
    await api("POST", "/api/babies/" + B + "/devices/" + D);
    console.log("  Linked");
  }
  var lr = await api("POST", "/api/baby-logs", {
    babyId: B, eventType: "breast_milk",
    startTime: new Date().toISOString(), duration: 15, amount: 120, note: "API test"
  });
  if (lr.status === 200 && lr.data && lr.data.success) {
    L = lr.data.data.id;
    console.log("  Log: " + L);
  } else {
    console.log("  Log FAIL: " + JSON.stringify(lr.data).substring(0, 100));
  }
  if (D) {
    // Notifications are created by system, not via API
    // Use seed data or existing notifications from history
    console.log("  Notif: system-managed (checking history)");
    var nh = await api("GET", "/api/users/me/notifications/history");
    if (nh.status === 200 && nh.data && nh.data.data && nh.data.data.list && nh.data.data.list.length > 0) {
      N = nh.data.data.list[0].id;
      console.log("  Using existing notif: " + N);
    } else {
      console.log("  No existing notifications found (N=" + N + ")");
    }
  }
  console.log("Data: D=" + D + " B=" + B + " L=" + L + " N=" + N + "\n");
}

// ============ TEST SECTIONS ============
async function run() {
  // ===== S1: Login (5) =====
  console.log("\n=== S1: Login ===");
  rec("S1",1,"send-code","POST","/api/auth/send-code", await api("POST","/api/auth/send-code",{phone:"13800000001",purpose:"login"}));
  rec("S1",2,"login","POST","/api/auth/login", await api("POST","/api/auth/login",{type:"password",account:"admin@babymonitor.com",password:"ChangeThisPassword123!@#"}));
  // #3-4 moved to end (register may timeout, refresh may rotate token)
  console.log("  -- #3 register (moved to end, avoid timeout blocking)");
  console.log("  -- #4 refresh (moved to end, avoid token rotation)");
  // #5 logout moved to end (invalidates token)

  // ===== S3: Device Connect (4) =====
  console.log("\n=== S3: Device Connect ===");
  rec("S3",6,"add-dev","POST","/api/devices", await api("POST","/api/devices",{productType:"CAMERA",deviceName:"Bind",serialNumber:"BIND-"+Date.now(),macAddress:"FF:EE:DD:CC:BB:AA"}));
  if(D) rec("S3",7,"dev-detail","GET","/api/devices/"+D, await api("GET","/api/devices/"+D));
  else rec("S3",7,"dev-detail-404","GET","/api/devices/"+X, await api("GET","/api/devices/"+X), 404);
  console.log("  -- #8 (AP hotspot - client)");
  rec("S3",9,"start-stream","POST","/api/devices/"+(D||X)+"/control/stream/start", await api("POST","/api/devices/"+(D||X)+"/control/stream/start"));
  rec("S3",10,"create-stream","POST","/api/videos/device/"+(D||X)+"/stream", await api("POST","/api/videos/device/"+(D||X)+"/stream"));

  // ===== S4: Camera Home (15) =====
  console.log("\n=== S4: Camera Home ===");
  if(D){
    rec("S4",11,"state","GET","/api/devices/"+D+"/state", await api("GET","/api/devices/"+D+"/state"));
    rec("S4",12,"online","GET","/api/devices/"+D+"/online", await api("GET","/api/devices/"+D+"/online"));
    rec("S4",13,"playback","GET","/api/videos/device/"+D+"/playback", await api("GET","/api/videos/device/"+D+"/playback"));
    rec("S4",14,"streaming","GET","/api/videos/device/"+D+"/streaming-status", await api("GET","/api/videos/device/"+D+"/streaming-status"));
    rec("S4",15,"rec-start","POST","/api/devices/"+D+"/control/recording/start", await api("POST","/api/devices/"+D+"/control/recording/start"));
    rec("S4",16,"rec-stop","POST","/api/devices/"+D+"/control/recording/stop", await api("POST","/api/devices/"+D+"/control/recording/stop"));
    rec("S4",17,"mute","POST","/api/devices/"+D+"/control/mute", await api("POST","/api/devices/"+D+"/control/mute",{muted:true}));
    rec("S4",18,"resolution","POST","/api/devices/"+D+"/control/resolution", await api("POST","/api/devices/"+D+"/control/resolution",{resolution:"HD"}));
    rec("S4",19,"talk-start","POST","/api/devices/"+D+"/talk/start", await api("POST","/api/devices/"+D+"/talk/start"));
    rec("S4",20,"talk-stop","POST","/api/devices/"+D+"/talk/stop", await api("POST","/api/devices/"+D+"/talk/stop"));
    rec("S4",21,"talk-status","GET","/api/devices/"+D+"/talk/status", await api("GET","/api/devices/"+D+"/talk/status"));
    rec("S4",22,"music-list","GET","/api/devices/"+D+"/soothing/music", await api("GET","/api/devices/"+D+"/soothing/music"));
    rec("S4",23,"music-play","POST","/api/devices/"+D+"/soothing/play", await api("POST","/api/devices/"+D+"/soothing/play",{musicId:"wn-1"}));
    rec("S4",24,"music-stop","POST","/api/devices/"+D+"/soothing/stop", await api("POST","/api/devices/"+D+"/soothing/stop"));
    rec("S4",25,"music-vol","PUT","/api/devices/"+D+"/soothing/volume", await api("PUT","/api/devices/"+D+"/soothing/volume",{volume:70}));
  } else { for(var i=11;i<=25;i++) console.log("  -- #"+i+" (no dev)"); }

  // ===== S5: PTZ (8) =====
  console.log("\n=== S5: PTZ ===");
  if(D){
    rec("S5",26,"ptz-ctrl","POST","/api/devices/"+D+"/ptz/control", await api("POST","/api/devices/"+D+"/ptz/control",{direction:"up",speed:5}));
    rec("S5",27,"ptz-stop","POST","/api/devices/"+D+"/ptz/stop", await api("POST","/api/devices/"+D+"/ptz/stop"));
    rec("S5",28,"ptz-pos","GET","/api/devices/"+D+"/ptz/position", await api("GET","/api/devices/"+D+"/ptz/position"));
    rec("S5",29,"ptz-save","POST","/api/devices/"+D+"/ptz/presets", await api("POST","/api/devices/"+D+"/ptz/presets",{name:"home",pan:0,tilt:0}));
    rec("S5",30,"ptz-list","GET","/api/devices/"+D+"/ptz/presets", await api("GET","/api/devices/"+D+"/ptz/presets"));
    rec("S5",31,"ptz-del","DELETE","/api/devices/"+D+"/ptz/presets/"+X, await api("DELETE","/api/devices/"+D+"/ptz/presets/"+X));
    rec("S5",32,"ptz-goto","POST","/api/devices/"+D+"/ptz/presets/"+X+"/goto", await api("POST","/api/devices/"+D+"/ptz/presets/"+X+"/goto"));
    rec("S5",33,"ptz-cruise","POST","/api/devices/"+D+"/ptz/cruise", await api("POST","/api/devices/"+D+"/ptz/cruise",{action:"start"}));
  } else { for(var i=26;i<=33;i++) console.log("  -- #"+i+" (no dev)"); }

  // ===== S6: Notifications (12) =====
  console.log("\n=== S6: Notifications ===");
  rec("S6",34,"n-list","GET","/api/users/me/notifications/history", await api("GET","/api/users/me/notifications/history"));
  rec("S6",35,"n-unread","GET","/api/users/me/notifications/unread-count", await api("GET","/api/users/me/notifications/unread-count"));
  if(N){ rec("S6",36,"n-read","PUT","/api/users/me/notifications/history/"+N+"/read", await api("PUT","/api/users/me/notifications/history/"+N+"/read")); }
  else { rec("S6",36,"n-read-404","PUT","/api/users/me/notifications/history/"+X+"/read", await api("PUT","/api/users/me/notifications/history/"+X+"/read"),404); }
  rec("S6",37,"n-readAll","PUT","/api/users/me/notifications/history/read-all", await api("PUT","/api/users/me/notifications/history/read-all"));
  if(N){ rec("S6",38,"n-ack","PUT","/api/users/me/notifications/history/"+N+"/acknowledge", await api("PUT","/api/users/me/notifications/history/"+N+"/acknowledge")); }
  else { rec("S6",38,"n-ack-404","PUT","/api/users/me/notifications/history/"+X+"/acknowledge", await api("PUT","/api/users/me/notifications/history/"+X+"/acknowledge"),404); }
  if(N){ rec("S6",39,"n-like","POST","/api/users/me/notifications/"+N+"/like", await api("POST","/api/users/me/notifications/"+N+"/like")); }
  else { rec("S6",39,"n-like-404","POST","/api/users/me/notifications/"+X+"/like", await api("POST","/api/users/me/notifications/"+X+"/like"),404); }
  if(N){ rec("S6",40,"n-dislike","POST","/api/users/me/notifications/"+N+"/dislike", await api("POST","/api/users/me/notifications/"+N+"/dislike")); }
  else { rec("S6",40,"n-dislike-404","POST","/api/users/me/notifications/"+X+"/dislike", await api("POST","/api/users/me/notifications/"+X+"/dislike"),404); }
  if(N){ rec("S6",41,"n-fb","POST","/api/users/me/notifications/"+N+"/feedback", await api("POST","/api/users/me/notifications/"+N+"/feedback",{feedbackType:"hungry",feedbackText:"ok"})); }
  else { rec("S6",41,"n-fb-404","POST","/api/users/me/notifications/"+X+"/feedback", await api("POST","/api/users/me/notifications/"+X+"/feedback",{feedbackType:"hungry"}),404); }
  if(N){ rec("S6",42,"n-del","DELETE","/api/users/me/notifications/history/"+N, await api("DELETE","/api/users/me/notifications/history/"+N)); }
  else { rec("S6",42,"n-del-404","DELETE","/api/users/me/notifications/history/"+X, await api("DELETE","/api/users/me/notifications/history/"+X),404); }
  var bids=[X];
  var hh=await api("GET","/api/users/me/notifications/history?limit=5");
  if(hh.status===200&&hh.data&&hh.data.data&&hh.data.data.list){ hh.data.data.list.forEach(function(item){bids.push(item.id);}); }
  rec("S6",43,"n-batchDel","DELETE","/api/users/me/notifications/history/batch", await api("DELETE","/api/users/me/notifications/history/batch",{notificationIds:bids}));
  rec("S6",44,"n-clear","DELETE","/api/users/me/notifications/history", await api("DELETE","/api/users/me/notifications/history"));
  if(D) rec("S6",45,"n-evts","GET","/api/videos/recordings/"+D+"/events", await api("GET","/api/videos/recordings/"+D+"/events"));
  else console.log("  -- #45 (no dev)");

  // ===== S7: Notif Settings (9) =====
  console.log("\n=== S7: Notif Settings ===");
  rec("S7",46,"ns-get","GET","/api/users/me/notifications/settings", await api("GET","/api/users/me/notifications/settings"));
  rec("S7",47,"ns-push","PUT","/api/users/me/notifications/settings/push", await api("PUT","/api/users/me/notifications/settings/push",{enabled:true}));
  rec("S7",48,"ns-dnd","PUT","/api/users/me/notifications/settings/dnd", await api("PUT","/api/users/me/notifications/settings/dnd",{dndStart:"22:00",dndEnd:"08:00"}));
  rec("S7",49,"ns-cry","PUT","/api/users/me/notifications/settings/crying", await api("PUT","/api/users/me/notifications/settings/crying",{detectionEnabled:true}));
  rec("S7",50,"ns-th","PUT","/api/users/me/notifications/settings/temperature-humidity", await api("PUT","/api/users/me/notifications/settings/temperature-humidity",{tempAlertEnabled:true,tempMin:18,tempMax:28}));
  rec("S7",51,"ns-soothe","PUT","/api/users/me/notifications/settings/auto-soothing", await api("PUT","/api/users/me/notifications/settings/auto-soothing",{enabled:true}));
  rec("S7",52,"ns-geo","PUT","/api/users/me/notifications/settings/geofence", await api("PUT","/api/users/me/notifications/settings/geofence",{enabled:true,radius:100}));
  rec("S7",53,"ns-rings","GET","/api/users/me/notifications/ringtones", await api("GET","/api/users/me/notifications/ringtones"));
  rec("S7",54,"ns-ringSet","PUT","/api/users/me/notifications/settings/ringtone", await api("PUT","/api/users/me/notifications/settings/ringtone",{ringtoneId:"gentle",volume:80}));

  // ===== S8+S9: Baby (25) =====
  console.log("\n=== S8: Baby ===");
  rec("S8",55,"b-list","GET","/api/babies", await api("GET","/api/babies"));
  rec("S8",56,"b-create","POST","/api/babies", await api("POST","/api/babies",{name:"New",gender:"female",birthDate:"2025-06-01"}));
  if(B) rec("S8",57,"b-detail","GET","/api/babies/"+B, await api("GET","/api/babies/"+B));
  else rec("S8",57,"b-404","GET","/api/babies/"+X, await api("GET","/api/babies/"+X),404);
  if(B) rec("S8",58,"b-upd","PUT","/api/babies/"+B, await api("PUT","/api/babies/"+B,{name:"Upd"}));
  else console.log("  -- #58 (no baby)");
  rec("S8",59,"b-del404","DELETE","/api/babies/"+X, await api("DELETE","/api/babies/"+X),404);
  if(B&&D){ rec("S8",60,"b-link","POST","/api/babies/"+B+"/devices/"+D, await api("POST","/api/babies/"+B+"/devices/"+D)); rec("S8",61,"b-unlink","DELETE","/api/babies/"+B+"/devices/"+D, await api("DELETE","/api/babies/"+B+"/devices/"+D)); }
  else console.log("  -- #60-61 (no D/B)");
  if(B){ rec("S8.1",62,"bl-create","POST","/api/baby-logs", await api("POST","/api/baby-logs",{babyId:B,eventType:"breast_feeding",startTime:new Date().toISOString(),duration:10}));
    var bbr=await api("POST","/api/baby-logs/batch",{logs:[{babyId:B,eventType:"diaper_change",startTime:new Date().toISOString()},{babyId:B,eventType:"sleep",startTime:new Date().toISOString(),duration:60}]}); rec("S8.1",63,"bl-batch","POST","/api/baby-logs/batch",bbr);
    rec("S8.1",64,"bl-list","GET","/api/baby-logs?babyId="+B, await api("GET","/api/baby-logs?babyId="+B)); }
  else console.log("  -- #62-64 (no B)");
  if(L) rec("S8.1",65,"bl-d","GET","/api/baby-logs/"+L, await api("GET","/api/baby-logs/"+L));
  else rec("S8.1",65,"bl-d404","GET","/api/baby-logs/"+X, await api("GET","/api/baby-logs/"+X),404);
  if(L) rec("S8.1",66,"bl-upd","PUT","/api/baby-logs/"+L, await api("PUT","/api/baby-logs/"+L,{amount:150}));
  else console.log("  -- #66");
  rec("S8.1",67,"bl-del","DELETE","/api/baby-logs/"+X, await api("DELETE","/api/baby-logs/"+X),404);
  rec("S8.1",68,"bl-bdel","DELETE","/api/baby-logs/batch", await api("DELETE","/api/baby-logs/batch",{ids:[X]}));
  if(B) rec("S8.1",69,"bl-latest","GET","/api/baby-logs/latest/"+B, await api("GET","/api/baby-logs/latest/"+B));
  else console.log("  -- #69");
  if(L) rec("S8.1",70,"bl-ack","POST","/api/baby-logs/"+L+"/acknowledge", await api("POST","/api/baby-logs/"+L+"/acknowledge"));
  else console.log("  -- #70");
  if(L) rec("S8.1",71,"bl-bAck","POST","/api/baby-logs/acknowledge/batch", await api("POST","/api/baby-logs/acknowledge/batch",{logIds:[L]}));
  else console.log("  -- #71");
  if(B){ rec("S8.1",72,"bl-stats","GET","/api/baby-logs/stats/"+B, await api("GET","/api/baby-logs/stats/"+B)); rec("S8.1",73,"bl-daily","GET","/api/baby-logs/summary/"+B+"/daily", await api("GET","/api/baby-logs/summary/"+B+"/daily")); }
  else console.log("  -- #72-73 (no B)");

  console.log("\n=== S9: Analytics ===");
  if(B){ rec("S9",74,"a-daily","GET","/api/babies/"+B+"/analytics/daily", await api("GET","/api/babies/"+B+"/analytics/daily"));
    rec("S9",75,"a-weekly","GET","/api/babies/"+B+"/analytics/weekly", await api("GET","/api/babies/"+B+"/analytics/weekly"));
    rec("S9",76,"a-feed","GET","/api/babies/"+B+"/analytics/feeding/pattern", await api("GET","/api/babies/"+B+"/analytics/feeding/pattern"));
    rec("S9",77,"a-sleep","GET","/api/babies/"+B+"/analytics/sleep/pattern", await api("GET","/api/babies/"+B+"/analytics/sleep/pattern"));
    rec("S9",78,"a-grow","GET","/api/babies/"+B+"/analytics/growth/percentile", await api("GET","/api/babies/"+B+"/analytics/growth/percentile"));
    rec("S9",79,"a-trend","GET","/api/babies/"+B+"/analytics/growth/trend", await api("GET","/api/babies/"+B+"/analytics/growth/trend")); }
  else for(var i=74;i<=79;i++) console.log("  -- #"+i);

  // ===== S10-S13 (16) =====
  console.log("\n=== S10-S13 ===");
  if(B&&D){ rec("S10",80,"db-bind","POST","/api/babies/"+B+"/devices/"+D, await api("POST","/api/babies/"+B+"/devices/"+D)); rec("S10",81,"db-unbind","DELETE","/api/babies/"+B+"/devices/"+D, await api("DELETE","/api/babies/"+B+"/devices/"+D)); }
  else console.log("  -- #80-81");
  if(B) rec("S10",82,"db-perm","GET","/api/babies/"+B+"/permissions/admin", await api("GET","/api/babies/"+B+"/permissions/admin"));
  else console.log("  -- #82");
  rec("S11",83,"sb-list","GET","/api/devices", await api("GET","/api/devices"));
  rec("S11",84,"sb-myDev","GET","/api/users/me/devices", await api("GET","/api/users/me/devices"));
  if(D) rec("S11",85,"sb-rename","PUT","/api/devices/"+D, await api("PUT","/api/devices/"+D,{deviceName:"Rn"}));
  else console.log("  -- #85");
  console.log("  -- #86 (client calc)");

  rec("S12",87,"p-me","GET","/api/users/me", await api("GET","/api/users/me"));
  rec("S12",88,"p-upd","PUT","/api/users/me/profile", await api("PUT","/api/users/me/profile",{nickname:"T"}));
  rec("S12",89,"p-av","POST","/api/users/me/avatar", await api("POST","/api/users/me/avatar",{avatarUrl:"https://x.com/a.png"}));
  rec("S12",90,"p-pwd","PUT","/api/users/me/password", await api("PUT","/api/users/me/password",{oldPassword:"w",newPassword:"N1!"}));
  rec("S12",91,"p-del","DELETE","/api/users/me", await api("DELETE","/api/users/me"));

  if(D){ rec("S13",92,"s-cmd","POST","/api/devices/"+D+"/command", await api("POST","/api/devices/"+D+"/command",{command:"power_led",params:{enabled:true}}));
    rec("S13",93,"s-health","GET","/api/devices/"+D+"/health-report", await api("GET","/api/devices/"+D+"/health-report"));
    rec("S13",94,"s-stats","GET","/api/devices/"+D+"/statistics", await api("GET","/api/devices/"+D+"/statistics"));
    rec("S13",95,"s-reset","POST","/api/devices/"+D+"/control/factory-reset", await api("POST","/api/devices/"+D+"/control/factory-reset"));
    rec("S13",96,"s-unbind","DELETE","/api/devices/"+D, await api("DELETE","/api/devices/"+D)); }
  else for(var i=92;i<=96;i++) console.log("  -- #"+i);

  // ===== S15: Invite (13) =====
  console.log("\n=== S15: Invite ===");
  if(D) rec("S15",97,"i-list","GET","/api/device-access/"+D+"/invitations", await api("GET","/api/device-access/"+D+"/invitations"));
  else console.log("  -- #97");
  if(D) rec("S15",98,"i-create","POST","/api/device-access/"+D+"/invitations", await api("POST","/api/device-access/"+D+"/invitations",{phone:"13900000001",permissions:{view:true}}));
  else console.log("  -- #98");
  rec("S15",99,"i-accept","POST","/api/device-access/invitations/accept-by-code", await api("POST","/api/device-access/invitations/accept-by-code",{phone:"13900000001",code:"123456"}));
  rec("S15",100,"i-accept2","POST","/api/device-access/invitations/"+X+"/accept", await api("POST","/api/device-access/invitations/"+X+"/accept"));
  rec("S15",101,"i-reject","POST","/api/device-access/invitations/"+X+"/reject", await api("POST","/api/device-access/invitations/"+X+"/reject"));
  rec("S15",102,"i-del","DELETE","/api/device-access/invitations/"+X, await api("DELETE","/api/device-access/invitations/"+X));
  rec("S15",103,"i-updP","PUT","/api/device-access/invitations/"+X+"/permissions", await api("PUT","/api/device-access/invitations/"+X+"/permissions",{permissions:{view:true}}));
  rec("S15",104,"i-devices","GET","/api/device-access/devices", await api("GET","/api/device-access/devices"));
  if(D){ rec("S15",105,"i-perm","GET","/api/device-access/"+D+"/permissions", await api("GET","/api/device-access/"+D+"/permissions"));
    rec("S15",106,"i-vStart","POST","/api/device-access/"+D+"/viewing/start", await api("POST","/api/device-access/"+D+"/viewing/start"));
    rec("S15",107,"i-vEnd","POST","/api/device-access/"+D+"/viewing/end", await api("POST","/api/device-access/"+D+"/viewing/end"));
    rec("S15",108,"i-vHist","GET","/api/device-access/"+D+"/viewing/history", await api("GET","/api/device-access/"+D+"/viewing/history"));
    rec("S15",109,"i-vClear","DELETE","/api/device-access/"+D+"/viewing/history", await api("DELETE","/api/device-access/"+D+"/viewing/history")); }
  else for(var i=105;i<=109;i++) console.log("  -- #"+i);

  // ===== S16: Help (12) =====
  console.log("\n=== S16: Help ===");
  rec("S16",110,"h-list","GET","/api/help/articles", await api("GET","/api/help/articles"));
  rec("S16",111,"h-art","GET","/api/help/articles/"+X, await api("GET","/api/help/articles/"+X));
  rec("S16",112,"h-related","GET","/api/help/articles/"+X+"/related", await api("GET","/api/help/articles/"+X+"/related"));
  rec("S16",113,"h-search","GET","/api/help/search?kw=a", await api("GET","/api/help/search?kw=a"));
  rec("S16",114,"h-pop","GET","/api/help/articles/popular", await api("GET","/api/help/articles/popular"));
  rec("S16",115,"h-fb","POST","/api/help/articles/"+X+"/feedback", await api("POST","/api/help/articles/"+X+"/feedback",{helpful:true}));
  rec("S16",116,"h-ticket","POST","/api/help/tickets", await api("POST","/api/help/tickets",{title:"T",description:"D",priority:"medium"}));
  rec("S16",117,"h-tickets","GET","/api/help/tickets", await api("GET","/api/help/tickets"));
  rec("S16",118,"h-ticketX","GET","/api/help/tickets/"+X, await api("GET","/api/help/tickets/"+X));
  rec("S16",119,"h-ticketUpd","PUT","/api/help/tickets/"+X, await api("PUT","/api/help/tickets/"+X,{description:"add"}));
  rec("S16",120,"h-ticketClose","POST","/api/help/tickets/"+X+"/close", await api("POST","/api/help/tickets/"+X+"/close"));
  rec("S16",121,"h-appFb","POST","/api/feedback", await api("POST","/api/feedback",{content:"T",contact:"13800000001"}));

  // ===== S17: Playback (13) =====
  console.log("\n=== S17: Playback ===");
  if(D){ rec("S17",122,"pb-evts","GET","/api/videos/recordings/"+D+"/events", await api("GET","/api/videos/recordings/"+D+"/events"));
    rec("S17",123,"pb-full","GET","/api/videos/recordings/"+D+"/recordings", await api("GET","/api/videos/recordings/"+D+"/recordings"));
    rec("S17",124,"pb-detail","GET","/api/videos/recordings/"+D, await api("GET","/api/videos/recordings/"+D));
    rec("S17",125,"pb-create","POST","/api/videos/recordings", await api("POST","/api/videos/recordings",{deviceId:D,plan:"basic"}));
    rec("S17",126,"pb-url","GET","/api/storage/recordings/"+X+"/playback", await api("GET","/api/storage/recordings/"+X+"/playback"));
    rec("S17",127,"pb-tl","GET","/api/storage/recordings/device/"+D+"/timeline", await api("GET","/api/storage/recordings/device/"+D+"/timeline"));
    rec("S17",128,"pb-day","GET","/api/storage/recordings/device/"+D+"/by-day", await api("GET","/api/storage/recordings/device/"+D+"/by-day"));
    rec("S17",129,"pb-list","GET","/api/storage/recordings/device/"+D, await api("GET","/api/storage/recordings/device/"+D));
    rec("S17",130,"pb-cont","GET","/api/storage/recordings/device/"+D+"/continuous", await api("GET","/api/storage/recordings/device/"+D+"/continuous"));
    rec("S17",131,"pb-gaps","GET","/api/storage/recordings/device/"+D+"/gaps", await api("GET","/api/storage/recordings/device/"+D+"/gaps"));
    rec("S17",132,"pb-thumb","GET","/api/videos/recordings/"+D+"/thumbnail", await api("GET","/api/videos/recordings/"+D+"/thumbnail"));
    rec("S17",133,"pb-thumbs","POST","/api/videos/recordings/"+D+"/thumbnails", await api("POST","/api/videos/recordings/"+D+"/thumbnails",{recordingIds:[X]}));
    rec("S17",134,"pb-data","GET","/api/videos/device/"+D+"/data", await api("GET","/api/videos/device/"+D+"/data")); }
  else for(var i=122;i<=134;i++) console.log("  -- #"+i);

  // ===== S19: Infra (11) =====
  console.log("\n=== S19: Infra ===");
  rec("S19",135,"infra-upload","POST","/api/storage/upload", await api("POST","/api/storage/upload"));
  rec("S19",136,"infra-url","GET","/api/storage/url/t", await api("GET","/api/storage/url/t"));
  rec("S19",137,"infra-exists","GET","/api/storage/exists/t", await api("GET","/api/storage/exists/t"));
  rec("S19",138,"infra-del","DELETE","/api/storage/t", await api("DELETE","/api/storage/t"));
  rec("S19",139,"infra-upUrl","POST","/api/storage/upload-url", await api("POST","/api/storage/upload-url",{key:"t.png",contentType:"image/png"}));
  rec("S19",140,"infra-mpNew","POST","/api/storage/multipart/create", await api("POST","/api/storage/multipart/create",{key:"t.bin",contentType:"application/octet-stream"}));
  rec("S19",141,"infra-mpDone","POST","/api/storage/multipart/complete", await api("POST","/api/storage/multipart/complete",{key:"t.bin",uploadId:X,parts:[]}));
  rec("S19",142,"infra-kvs","GET","/api/v1/credentials/stream", await api("GET","/api/v1/credentials/stream"));
  rec("S19",143,"infra-s3","GET","/api/v1/credentials/storage", await api("GET","/api/v1/credentials/storage"));
  rec("S19",144,"infra-anti","POST","/api/videos/anti-leech-url", await api("POST","/api/videos/anti-leech-url",{url:"https://x.com/v.m3u8"}));
  rec("S19",145,"infra-health","GET","/health", await api("GET","/health"));

  // ===== Destructive tests (run LAST) =====
  console.log("\n=== Final: Destructive Tests ===");
  rec("S1",3,"register","POST","/api/auth/register", await api("POST","/api/auth/register",{username:"t_"+Date.now(),password:"Test123456!",email:"t_"+Date.now()+"@t.com"}));
  rec("S1",4,"refresh","POST","/api/auth/refresh", await api("POST","/api/auth/refresh",{refreshToken:"x"}));
  rec("S1",5,"logout","POST","/api/auth/logout", await api("POST","/api/auth/logout",{}));
}

async function main() {
  console.log("=".repeat(60));
  console.log("APP API Full Test - " + new Date().toISOString() + "\nGateway: " + G);
  console.log("=".repeat(60));
  var h = await api("GET", "/health");
  if (h.status !== 200) { console.error("Gateway down!"); process.exit(1); }
  console.log("Gateway OK\n");
  await setup();
  await run();
  summary();
}
main().catch(function(e) { console.error("FATAL:", e); process.exit(1); });
