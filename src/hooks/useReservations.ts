import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
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
          const reservation: Reservation = {
            id: docSnap.id,
            date: data.date,
            time: data.time,
            durationMinutes: data.durationMinutes ?? 60,
            roomId: data.roomId,
            reservedBy: data.reservedBy ?? "",
            reservedEmail: data.reservedEmail ?? "",
            kind: data.kind === "special" || data.kind === "closed" ? data.kind : undefined
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

  const addReservation = (reservation: Reservation) => {
    if (!db) return;
    void setDoc(doc(db, "reservations", reservation.id), {
      ...reservation,
      createdAt: serverTimestamp()
    });
  };

  const upsertReservation = (reservation: Reservation) => {
    if (!db) return;
    void setDoc(doc(db, "reservations", reservation.id), {
      ...reservation,
      updatedAt: serverTimestamp()
    }, { merge: true });
  };

  const releaseReservation = (_dateKey: string, reservationId: string) => {
    if (!db) return;
    void deleteDoc(doc(db, "reservations", reservationId));
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
