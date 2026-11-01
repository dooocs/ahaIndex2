// Who is on which bus, from what every visitor reports in their presence state ({ line, bus, since, … }).
// There is no server to hand out seats, so the rule is simply: on each bus, riders in boarding order
// (since, then id) keep their place; anyone past the capacity — two people taking the last seat at once —
// sees they are over and gets off again. Everyone applies the same rule to the same list, so they agree.

const order = (a, b) => a.ride.since - b.ride.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** riders: [{ id, ride }] (yourself included). Those on bus (line, bus), in boarding order. */
export function ridersOn(riders, line, bus) {
  return riders.filter(r => r && r.ride && r.ride.line === line && r.ride.bus === bus).sort(order);
}

/** Is there room for one more on this bus? */
export function hasRoom(riders, line, bus, cap) {
  return ridersOn(riders, line, bus).length < cap;
}

/** Should rider `id` get off again because the bus filled up before them? */
export function isBumped(riders, line, bus, cap, id) {
  const i = ridersOn(riders, line, bus).findIndex(r => r.id === id);
  return i >= cap;
}
