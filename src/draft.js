// Warnings shown BEFORE something is saved.
//
// The idea is simple: make a copy of the world with the new or edited quest
// (or the new move) already in it, work out the affected days with the
// normal schedule engine, and look at what happened to the draft.
// Because we reuse expandDay, the warnings can never disagree with what the
// week view will show after saving.

const { expandDay, occurrenceDates, changeFitsQuest } = require('./schedule');

// The id the draft quest gets inside the copied world.
const DRAFT_ID = 'draft';

// A world without the quest being edited (or the original world when
// nothing is being edited).
function worldWithout(world, editingId) {
  if (editingId === null || editingId === undefined) return world;
  return {
    ...world,
    quests: world.quests.filter((q) => q.id !== editingId),
    changes: world.changes.filter((c) => c.questId !== editingId),
  };
}

// A world where the draft has replaced the quest being edited. The edited
// quest's skips and moves are carried over to the draft, except the ones
// saving will delete (see changeFitsQuest), so we never warn about a
// make-up that won't exist.
function worldWithDraft(world, draft, editingId) {
  const base = worldWithout(world, editingId);
  const carriedChanges = world.changes
    .filter((c) => editingId !== null && c.questId === editingId && changeFitsQuest(c, draft))
    .map((c) => ({ ...c, questId: DRAFT_ID }));
  return {
    ...base,
    quests: base.quests.concat([{ ...draft, id: DRAFT_ID }]),
    changes: base.changes.concat(carriedChanges),
  };
}

// Adds occurrences to `list` unless an occurrence with the same key is
// already there.
function addUnique(list, occurrences) {
  for (const occ of occurrences) {
    if (!list.some((o) => o.key === occ.key)) list.push(occ);
  }
}

// Looks at the draft's own occurrences on each date and collects what they
// clash with and which limited events cancel them.
function collectWarnings(newWorld, dates, isDraftOccurrence) {
  const clashes = [];
  const cancelledBy = [];
  const cancelledDates = [];
  for (const date of dates) {
    const day = expandDay(newWorld, date);
    for (const occ of day.filter(isDraftOccurrence)) {
      addUnique(clashes, day.filter((o) => occ.clashKeys.includes(o.key)));
      if (occ.status === 'cancelled') {
        if (!cancelledBy.includes(occ.cancelledBy)) cancelledBy.push(occ.cancelledBy);
        if (!cancelledDates.includes(occ.date)) cancelledDates.push(occ.date);
      }
    }
  }
  return { clashes, cancelledBy, cancelledDates };
}

// Occurrences that are active before the change and cancelled after it.
function newlyCancelled(oldWorld, newWorld, dates) {
  const result = [];
  for (const date of dates) {
    const before = expandDay(oldWorld, date);
    const after = expandDay(newWorld, date);
    for (const occ of after) {
      const old = before.find((o) => o.key === occ.key);
      if (occ.status === 'cancelled' && old && old.status === 'active') result.push(occ);
    }
  }
  return result;
}

// Checks a new or edited quest.
// Returns { clashes, cancelledBy, wouldCancel }.
function checkDraft(world, draft, { editingId = null } = {}) {
  const newWorld = worldWithDraft(world, draft, editingId);
  const draftQuest = newWorld.quests.find((q) => q.id === DRAFT_ID);

  // The draft's own dates, plus the dates of any make-ups it carries over.
  const dates = occurrenceDates(newWorld, draftQuest);
  for (const change of newWorld.changes) {
    if (change.questId === DRAFT_ID && change.action === 'move' && !dates.includes(change.newDate)) {
      dates.push(change.newDate);
    }
  }

  const { clashes, cancelledBy, cancelledDates } = collectWarnings(newWorld, dates, (o) => o.questId === DRAFT_ID);
  // When editing a limited event, compare against the world WITHOUT it, so
  // the preview lists everything the event cancels, not only the new ones.
  const wouldCancel = draft.kind === 'limited' ? newlyCancelled(worldWithout(world, editingId), newWorld, dates) : [];
  return { clashes, cancelledBy, cancelledDates, wouldCancel };
}

// Checks moving one occurrence of a weekly quest to a new slot
// ({ date, start, end }). Returns the same shape as checkDraft.
function checkMove(world, questId, originalDate, slot) {
  const otherChanges = world.changes.filter((c) => !(c.questId === questId && c.originalDate === originalDate));
  const move = { id: DRAFT_ID, questId, originalDate, action: 'move', newDate: slot.date, newStart: slot.start, newEnd: slot.end };
  const newWorld = { ...world, changes: otherChanges.concat([move]) };
  const { clashes, cancelledBy, cancelledDates } = collectWarnings(newWorld, [slot.date], (o) => o.key === 'makeup:' + DRAFT_ID);
  return { clashes, cancelledBy, cancelledDates, wouldCancel: [] };
}

// Which warnings the form must show, in order (spec 7.4). Every one that
// applies is shown, one after the other, and each must be accepted:
// a quest can land on a limited-event day AND clash on other weeks.
function warningSteps(checks) {
  const steps = [];
  if (checks.wouldCancel.length > 0) steps.push('wouldCancel');
  if (checks.cancelledBy.length > 0) steps.push('cancelledBy');
  if (checks.clashes.length > 0) steps.push('clashes');
  return steps;
}

module.exports = { checkDraft, checkMove, warningSteps };
