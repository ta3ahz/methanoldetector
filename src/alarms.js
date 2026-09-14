'use strict';

const config = require('./config');
const state = require('./state');
const db = require('./db');

// Alarm durum makinesi: NORMAL -> ACTIVE -> CLEARED.
// ACTIVE'e geçişte ve CLEARED'a dönüşte birer bildirim.
// ACTIVE kaldığı sürece ALARM_REPEAT_MIN'de bir hatırlatma.
//
// Kullanım: her poll sonrası evaluate(conditions) çağrılır. conditions,
// tip -> { active: bool, value } haritasıdır. index.js bunu doldurur.

let notifier = null;
function setNotifier(n) {
  notifier = n;
}

// İnsan okur mesaj metinleri
function messageFor(type, phase, value) {
  const v = value != null ? ` (değer: ${value})` : '';
  const labels = {
    GAS_HIGH: 'YÜKSEK GAZ ALARMI',
    GAS_LOW: 'Ön alarm — gaz seviyesi',
    SENSOR_FAULT: 'SENSÖR ARIZASI',
    COMM_LOSS: 'Haberleşme kesintisi (Modbus)',
    LINK_DOWN: 'Bağlantı yok / veri eski',
  };
  const label = labels[type] || type;
  if (phase === 'ACTIVE') return `🔴 ${label} AKTİF${v}`;
  if (phase === 'REMIND') return `🔁 ${label} halen aktif${v}`;
  return `🟢 ${label} normale döndü${v}`;
}

async function fire(type, phase, value) {
  const text = messageFor(type, phase, value);
  if (notifier) await notifier.send(text);
}

// conditions: { GAS_HIGH: {active, value}, ... }
function evaluate(conditions) {
  const now = Date.now();
  const repeatMs = config.alarmRepeatMin * 60000;

  for (const [type, cond] of Object.entries(conditions)) {
    const existing = state.alarms[type];
    const isActive = !!cond.active;

    if (isActive) {
      if (!existing || existing.state !== 'ACTIVE') {
        // NORMAL/CLEARED -> ACTIVE
        state.alarms[type] = {
          state: 'ACTIVE',
          since: now,
          value: cond.value ?? null,
          lastNotified: now,
        };
        db.insertAlarm(now, type, 'ACTIVE', cond.value);
        fire(type, 'ACTIVE', cond.value);
      } else {
        // ACTIVE devam ediyor: değer güncelle, gerekirse hatırlat
        existing.value = cond.value ?? existing.value;
        if (now - existing.lastNotified >= repeatMs) {
          existing.lastNotified = now;
          fire(type, 'REMIND', existing.value);
        }
      }
    } else if (existing && existing.state === 'ACTIVE') {
      // ACTIVE -> CLEARED
      existing.state = 'CLEARED';
      existing.clearedAt = now;
      db.insertAlarm(now, type, 'CLEARED', cond.value);
      fire(type, 'CLEARED', cond.value);
    }
  }
}

// API için: yalnızca ACTIVE olanların özeti
function activeAlarms() {
  const out = [];
  for (const [type, a] of Object.entries(state.alarms)) {
    if (a.state === 'ACTIVE') {
      out.push({ type, since: a.since, value: a.value });
    }
  }
  return out;
}

module.exports = { setNotifier, evaluate, activeAlarms };
