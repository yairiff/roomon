import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import type { Room } from "../types/schedule";
import type { RoomMeta, RoomRecord } from "../types/admin";

const fallbackRoomName = (id: string) => id.replace(/_/g, " ");

export function useRooms() {
  const [rawRooms, setRawRooms] = useState<RoomRecord[]>([]);
  const [roomOverrides, setRoomOverrides] = useState<
    Record<string, { imageUrl?: string; rehearsalSuitable?: boolean; recordingSuitable?: boolean }>
  >({});
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
            imageUrl: typeof data.imageUrl === "string" ? data.imageUrl.trim() || undefined : undefined,
            rehearsalSuitable: typeof data.rehearsalSuitable === "boolean" ? data.rehearsalSuitable : undefined,
            recordingSuitable: typeof data.recordingSuitable === "boolean" ? data.recordingSuitable : undefined,
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
        setRawRooms(next);
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

  useEffect(() => {
    if (!db) return;
    const overridesRef = collection(db, "room_overrides");
    const unsubscribe = onSnapshot(
      overridesRef,
      (snapshot) => {
        const next: Record<string, { imageUrl?: string; rehearsalSuitable?: boolean; recordingSuitable?: boolean }> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<{ imageUrl?: string; rehearsalSuitable?: boolean; recordingSuitable?: boolean }>;
          const id = docSnap.id;
          if (!id) return;
          const imageUrl = typeof data.imageUrl === "string" ? data.imageUrl.trim() : "";
          const rehearsalSuitable = typeof data.rehearsalSuitable === "boolean" ? data.rehearsalSuitable : undefined;
          const recordingSuitable = typeof data.recordingSuitable === "boolean" ? data.recordingSuitable : undefined;
          next[id] = {
            ...(imageUrl ? { imageUrl } : {}),
            ...(typeof rehearsalSuitable === "boolean" ? { rehearsalSuitable } : {}),
            ...(typeof recordingSuitable === "boolean" ? { recordingSuitable } : {})
          };
        });
        setRoomOverrides(next);
      },
      () => {
        // If overrides collection is blocked by rules, fall back to base room docs only.
        setRoomOverrides({});
      }
    );
    return () => unsubscribe();
  }, []);

  const rooms = useMemo<RoomRecord[]>(
    () =>
      rawRooms.map((room) => {
        const override = roomOverrides[room.id];
        if (!override) return room;
        return {
          ...room,
          imageUrl:
            typeof override.imageUrl === "string"
              ? override.imageUrl || undefined
              : room.imageUrl,
          rehearsalSuitable:
            typeof override.rehearsalSuitable === "boolean"
              ? override.rehearsalSuitable
              : room.rehearsalSuitable,
          recordingSuitable:
            typeof override.recordingSuitable === "boolean"
              ? override.recordingSuitable
              : room.recordingSuitable
        };
      }),
    [rawRooms, roomOverrides]
  );

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
        externalId: room.externalId,
        imageUrl: room.imageUrl,
        rehearsalSuitable: room.rehearsalSuitable,
        recordingSuitable: room.recordingSuitable
      })),
    [rooms]
  );

  const upsertRoom = async (room: RoomRecord) => {
    if (!db) return;
    if (!room.id) return;
    const imageUrl = (room.imageUrl || "").trim();
    const rehearsalSuitable = Boolean(room.rehearsalSuitable);
    const recordingSuitable = Boolean(room.recordingSuitable);
    let baseWriteError: unknown = null;
    try {
      await setDoc(doc(db, "rooms", room.id), {
        ...room,
        imageUrl: imageUrl || undefined,
        rehearsalSuitable,
        recordingSuitable
      });
    } catch (error) {
      baseWriteError = error;
    }

    let overrideWriteError: unknown = null;
    try {
      await setDoc(doc(db, "room_overrides", room.id), {
        imageUrl: imageUrl || "",
        rehearsalSuitable,
        recordingSuitable
      });
    } catch (error) {
      overrideWriteError = error;
    }

    // Some projects restrict edits on API-synced room docs.
    // If override persisted, treat this as success so custom room settings still work.
    if (baseWriteError && !overrideWriteError && room.syncSource === "api") {
      return;
    }

    // If both failed, surface the base error (or the override one when base succeeded).
    if (baseWriteError && overrideWriteError) {
      throw baseWriteError;
    }
    if (baseWriteError) {
      throw baseWriteError;
    }
  };

  const removeRoom = async (id: string) => {
    if (!db) return;
    if (!id) return;
    await deleteDoc(doc(db, "rooms", id));
    try {
      await deleteDoc(doc(db, "room_overrides", id));
    } catch {
      // best effort
    }
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
