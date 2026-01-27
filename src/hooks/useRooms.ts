import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import type { Room } from "../types/schedule";
import type { RoomMeta, RoomRecord } from "../types/admin";

const fallbackRoomName = (id: string) => id.replace(/_/g, " ");

export function useRooms() {
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [roomsReady, setRoomsReady] = useState<boolean>(!db);
  const [roomsError, setRoomsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setRoomsError("Firestore is not configured.");
      setRoomsReady(true);
      return;
    }

    const roomsRef = collection(db, "rooms");
    const unsubscribe = onSnapshot(
      roomsRef,
      (snapshot) => {
        const next: RoomRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<RoomRecord>;
          const id = docSnap.id;
          if (!id) return;
          const name = data.name || fallbackRoomName(id);
          next.push({
            id,
            name,
            shortName: data.shortName || name,
            openMinutes: data.openMinutes,
            closeMinutes: data.closeMinutes,
            isClosed: data.isClosed,
            sortOrder: data.sortOrder,
            note: data.note
          });
        });
        next.sort((a, b) => {
          const orderA = a.sortOrder ?? 9999;
          const orderB = b.sortOrder ?? 9999;
          if (orderA !== orderB) return orderA - orderB;
          return a.name.localeCompare(b.name);
        });
        setRooms(next);
        setRoomsError("");
        setRoomsReady(true);
      },
      () => {
        setRoomsError("Failed to load rooms.");
        setRoomsReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const roomMeta = useMemo(() => {
    const map: Record<string, RoomMeta> = {};
    rooms.forEach((room) => {
      map[room.id] = {
        openMinutes: room.openMinutes,
        closeMinutes: room.closeMinutes,
        isClosed: room.isClosed,
        sortOrder: room.sortOrder,
        note: room.note
      };
    });
    return map;
  }, [rooms]);

  const roomList: Room[] = useMemo(
    () => rooms.map((room) => ({ id: room.id, name: room.name, shortName: room.shortName })),
    [rooms]
  );

  const upsertRoom = async (room: RoomRecord) => {
    if (!db) return;
    if (!room.id) return;
    await setDoc(doc(db, "rooms", room.id), {
      ...room
    });
  };

  const removeRoom = async (id: string) => {
    if (!db) return;
    if (!id) return;
    await deleteDoc(doc(db, "rooms", id));
  };

  return {
    rooms: roomList,
    roomsRaw: rooms,
    roomMeta,
    roomsReady,
    roomsError,
    upsertRoom,
    removeRoom
  };
}
