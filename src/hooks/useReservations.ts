import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { stripUndefined } from "../lib/stripUndefined";
import type { Reservation, ReservationMap } from "../types/reservations";

export function useReservations() {
  const [reservationMap, setReservationMap] = useState<ReservationMap>({});
  const [reservationsReady, setReservationsReady] = useState<boolean>(!db);
  const [reservationsError, setReservationsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      setReservationsReady(true);
      return;
    }

    const reservationsRef = collection(db, "reservations");
    const unsubscribe = onSnapshot(
      reservationsRef,
      (snapshot) => {
        const nextMap: ReservationMap = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<Reservation>;
          if (!data.date || !data.roomId || data.time === undefined) return;
          const kind = data.kind === "special" || data.kind === "closed" ? data.kind : undefined;
          const reservation: Reservation = {
            id: docSnap.id,
            date: data.date,
            time: data.time,
            durationMinutes: data.durationMinutes ?? 60,
            roomId: data.roomId,
            reservedBy: data.reservedBy ?? "",
            reservedEmail: data.reservedEmail ?? "",
            ...(kind ? { kind } : {})
          };
          if (!nextMap[reservation.date]) {
            nextMap[reservation.date] = [];
          }
          nextMap[reservation.date].push(reservation);
        });
        setReservationMap(nextMap);
        setReservationsError("");
        setReservationsReady(true);
      },
      () => {
        setReservationsError("Failed to load reservations from Firestore.");
        setReservationsReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const addReservation = async (reservation: Reservation) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await setDoc(doc(db, "reservations", reservation.id), {
        ...stripUndefined(reservation as unknown as Record<string, unknown>),
        createdAt: serverTimestamp()
      });
      return true;
    } catch {
      setReservationsError("Failed to save reservation.");
      return false;
    }
  };

  const upsertReservation = async (reservation: Reservation) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await setDoc(
        doc(db, "reservations", reservation.id),
        {
          ...stripUndefined(reservation as unknown as Record<string, unknown>),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      return true;
    } catch {
      setReservationsError("Failed to update reservation.");
      return false;
    }
  };

  const releaseReservation = async (_dateKey: string, reservationId: string) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await deleteDoc(doc(db, "reservations", reservationId));
      return true;
    } catch {
      setReservationsError("Failed to delete reservation.");
      return false;
    }
  };

  return {
    reservationMap,
    addReservation,
    upsertReservation,
    releaseReservation,
    reservationsReady,
    reservationsError
  };
}
