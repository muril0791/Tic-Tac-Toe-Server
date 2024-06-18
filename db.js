import { Low, JSONFile } from "lowdb";

const adapter = new JSONFile("db.json");
const db = new Low(adapter);

export async function initializeDatabase() {
  await db.read();
  db.data ||= { rooms: {} };
}

export async function saveRooms(rooms) {
  db.data.rooms = rooms;
  await db.write();
}

export function getRooms() {
  return db.data.rooms;
}
