// Agenda de reuniões: horários livres, agendamento (com Google Meet quando conectado) e lembretes.
// Funciona também sem Google: usa só as reuniões registradas na plataforma.
import { db } from "./db";
import { logActivity } from "./activity";
import { getOption } from "./settings";
import { busyIntervals, cancelCalendarEvent, createCalendarEvent, googleConnected } from "./google";
import { sendWhatsApp } from "./whatsapp";
import { date, time, zonedParts, zonedTime } from "./utils";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

async function config() {
  const [hours, days, duration] = await Promise.all([getOption("meeting_hours"), getOption("meeting_days"), getOption("meeting_duration")]);
  const [startH, endH] = hours.split("-").map((t) => t.trim().split(":").map(Number));
  return {
    start: { h: startH[0] ?? 9, m: startH[1] ?? 0 },
    end: { h: endH?.[0] ?? 18, m: endH?.[1] ?? 0 },
    days: days.split(",").map((d) => Number(d.trim())).filter((d) => d >= 0 && d <= 6),
    minutes: Math.max(15, Number(duration) || 30),
  };
}

async function busy(from: Date, to: Date) {
  const local = await db.meeting.findMany({
    where: { status: "SCHEDULED", startAt: { lt: to }, endAt: { gt: from } },
    select: { startAt: true, endAt: true },
  });
  const intervals = local.map((m) => ({ start: m.startAt, end: m.endAt }));
  if (await googleConnected()) intervals.push(...(await busyIntervals(from, to)));
  return intervals;
}

export function slotLabel(d: Date) {
  return `${WEEKDAY[zonedParts(d).weekday]} ${date(d, true)}`;
}

/** Próximos horários livres (a partir de 2h no futuro), respeitando dias/horário configurados. */
export async function availableSlots(daysAhead = 7, max = 8) {
  const cfg = await config();
  const now = new Date();
  const earliest = new Date(now.getTime() + 2 * 3600_000);
  const until = new Date(now.getTime() + daysAhead * 86400_000);
  const blocked = await busy(earliest, until);
  const slots: { start: string; label: string }[] = [];

  const today = zonedParts(now);
  for (let i = 0; i <= daysAhead && slots.length < max; i++) {
    // dias e horários calculados no fuso da agência
    const day = zonedParts(zonedTime(today.year, today.month, today.day + i, 12, 0));
    if (!cfg.days.includes(day.weekday)) continue;
    const cursor = zonedTime(day.year, day.month, day.day, cfg.start.h, cfg.start.m);
    const dayEnd = zonedTime(day.year, day.month, day.day, cfg.end.h, cfg.end.m);
    if (cursor > until) break;
    while (cursor.getTime() + cfg.minutes * 60_000 <= dayEnd.getTime() && slots.length < max) {
      const end = new Date(cursor.getTime() + cfg.minutes * 60_000);
      const free = cursor >= earliest && !blocked.some((b) => b.start < end && b.end > cursor);
      if (free) slots.push({ start: cursor.toISOString(), label: slotLabel(cursor) });
      cursor.setTime(cursor.getTime() + cfg.minutes * 60_000);
    }
  }
  return slots;
}

export async function bookMeeting(input: {
  start: Date;
  title: string;
  description?: string;
  leadId?: string | null;
  companyId?: string | null;
  attendeeEmail?: string | null;
  bookedBy?: string;
}) {
  const cfg = await config();
  const end = new Date(input.start.getTime() + cfg.minutes * 60_000);
  if (input.start.getTime() < Date.now()) throw new Error("Horário no passado.");
  const conflicts = await busy(input.start, end);
  if (conflicts.some((b) => b.start < end && b.end > input.start)) {
    throw new Error("Horário não está mais livre. Consulte os horários disponíveis de novo.");
  }

  let event: { eventId?: string; eventLink?: string; meetLink?: string } = {};
  if (await googleConnected()) {
    event = await createCalendarEvent({
      title: input.title,
      description: input.description,
      start: input.start,
      end,
      attendeeEmail: input.attendeeEmail,
    });
  }

  const meeting = await db.meeting.create({
    data: {
      title: input.title,
      description: input.description,
      startAt: input.start,
      endAt: end,
      leadId: input.leadId ?? undefined,
      companyId: input.companyId ?? undefined,
      attendeeEmail: input.attendeeEmail ?? undefined,
      bookedBy: input.bookedBy ?? "ADMIN",
      ...event,
    },
  });
  if (input.leadId) {
    await db.lead.update({ where: { id: input.leadId }, data: { stage: "MEETING", nextFollowUpAt: null } });
  }
  await logActivity({
    type: "meeting.booked",
    summary: `📅 Reunião marcada: ${input.title} — ${slotLabel(input.start)}`,
    actor: input.bookedBy ?? "ADMIN",
    leadId: input.leadId,
    companyId: input.companyId,
  });
  return meeting;
}

export async function cancelMeeting(meetingId: string, actor = "ADMIN") {
  const m = await db.meeting.update({ where: { id: meetingId }, data: { status: "CANCELED" } });
  if (m.eventId && (await googleConnected())) {
    try {
      await cancelCalendarEvent(m.eventId);
    } catch (err) {
      console.error("[agenda] falha ao cancelar no Google", err);
    }
  }
  await logActivity({ type: "meeting.canceled", summary: `Reunião cancelada: ${m.title}`, actor, leadId: m.leadId, companyId: m.companyId });
  return m;
}

/** Lembrete no WhatsApp ~1h antes de cada reunião. */
export async function runMeetingReminders() {
  const soon = await db.meeting.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startAt: { gte: new Date(), lte: new Date(Date.now() + 70 * 60_000) },
    },
    include: { lead: true, company: true },
  });
  let sent = 0;
  for (const m of soon) {
    const phone = m.lead?.phone ?? m.company?.whatsapp;
    if (phone) {
      const name = (m.lead?.name ?? m.company?.contactName ?? "").split(" ")[0];
      await sendWhatsApp({
        phone,
        author: "SYSTEM",
        text: `Oi${name ? `, ${name}` : ""}! Lembrete da nossa reunião hoje às ${time(m.startAt)} 🙂${m.meetLink ? `\nLink: ${m.meetLink}` : ""}`,
      });
      sent++;
    }
    await db.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
  }
  return sent;
}
