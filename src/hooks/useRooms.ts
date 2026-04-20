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
          const apiName = typeof data.apiName === "string" ? data.apiName.trim() : "";
          const apiShortName = typeof data.apiShortName === "string" ? data.apiShortName.trim() : "";
          const name = (typeof data.name === "string" ? data.name.trim() : "") || apiName || fallbackRoomName(id);
          const shortName = (typeof data.shortName === "string" ? data.shortName.trim() : "") || apiShortName || name;
          next.push({
            id,
            name,
            shortName,
            apiName: apiName || undefined,
            apiShortName: apiShortName || undefined,
            externalId: typeof data.externalId === "string" ? data.externalId : undefined,
            externalSlug: typeof data.externalSlug === "string" ? data.externalSlug : undefined,
            syncSource: data.syncSource === "api" ? "api" : data.syncSource === "manual" ? "manual" : undefined,
            syncHash: typeof data.syncHash === "string" ? data.syncHash : undefined,
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
        isClosed: room.isClosed,
        sortOrder: room.sortOrder,
        note: room.note
      };
    });
    return map;
  }, [rooms]);

  const roomList: Room[] = useMemo(
    () =>
      rooms.map((room) => ({
        id: room.id,
        name: room.name,
        shortName: room.shortName,
        externalId: room.externalId
      })),
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
