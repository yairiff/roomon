import ScheduleGrid from "./views/ScheduleGrid";
import Legend from "./views/Legend";
import LiveView from "./views/LiveView";
import BookingFinder from "./views/BookingFinder";
import MyScheduleView from "./views/MyScheduleView";
import type { WeekDate } from "../../lib/date";
import type { DayKey, Lesson, Room, TimeSlot } from "../../types/schedule";
import type { ReservationMap, ReserveRequest } from "../../types/reservations";
import type { User } from "../../types/auth";
import type { MySchedulePin } from "../../types/mySchedule";
import type { RoomMeta } from "../../types/admin";
import type { ViewMode } from "../../types/ui";

export type HomeViewRouterProps = {
  view: ViewMode;
  rooms: Room[];
  lessons: Lesson[];
  reservationMap: ReservationMap;
  roomMeta?: Record<string, RoomMeta>;
  getLessonsForDate: (dateKey: string, dayKey: DayKey) => Lesson[];
  startHour: number;
  endHour: number;
  nowMinutes: number;
  todayDateKey: string;
  todayDayKey: DayKey;

  // Finder
  onFinderDateWindowChange: (startDate: string, endDate: string) => void;

  // My schedule
  myScheduleMode: "day" | "week" | "agenda";
  onMyScheduleModeChange: (mode: "day" | "week" | "agenda") => void;
  myScheduleAgendaDays: number;
  onMyScheduleAgendaLoadMore: () => void;
  pins: MySchedulePin[];
  onOpenPinned: (pin: MySchedulePin) => void;
  onSelectedDateChange: (dateKey: string) => void;

  // Schedule view
  allRooms: boolean;
  roomMode: "day" | "week";
  weekDates: WeekDate[];
  roomDates: WeekDate[];
  timeSlots: TimeSlot[];
  selectedDate: string;
  selectedDayKey: DayKey;
  selectedRoom: string;
  currentUser: User | null;
  adminMode: boolean;
  onRoomSelect: (roomId: string, dateKey: string) => void;
  onDateSelect: (dateKey: string) => void;

  // Schedule interactions
  onReserve: (request: ReserveRequest) => void;
  onRelease: (dateKey: string, reservationId: string) => void;
  onEditReservation: (dateKey: string, reservationId: string) => void;
  onLessonDetails: (lessonId: string, dateKey: string) => void;
  onSpecialDetails: (reservationId: string, dateKey: string) => void;
  onClosedDetails: (reservationId: string, dateKey: string) => void;
  onAdminSlotClick: (request: ReserveRequest) => void;
  onAdminLessonClick: (lessonId: string, dateKey: string) => void;
  onAdminReservationClick: (reservationId: string, dateKey: string) => void;
  onReservationClick: (reservationId: string, dateKey: string) => void;
};

export default function HomeViewRouter({
  view,
  rooms,
  lessons,
  reservationMap,
  startHour,
  endHour,
  roomMeta,
  getLessonsForDate,
  nowMinutes,
  todayDateKey,
  todayDayKey,
  onFinderDateWindowChange,
  myScheduleMode,
  onMyScheduleModeChange,
  myScheduleAgendaDays,
  onMyScheduleAgendaLoadMore,
  pins,
  onOpenPinned,
  weekDates,
  roomDates,
  timeSlots,
  selectedDate,
  selectedDayKey,
  selectedRoom,
  currentUser,
  onReserve,
  onRelease,
  onEditReservation,
  onLessonDetails,
  onSpecialDetails,
  onClosedDetails,
  onAdminSlotClick,
  onAdminLessonClick,
  onAdminReservationClick,
  onReservationClick,
  adminMode,
  allRooms,
  roomMode,
  onRoomSelect,
  onDateSelect,
  onSelectedDateChange
}: HomeViewRouterProps) {
  if (view === "live") {
    return (
      <LiveView
        rooms={rooms}
        lessons={getLessonsForDate(todayDateKey, todayDayKey)}
        reservationMap={reservationMap}
        dateKey={todayDateKey}
        dayKey={todayDayKey}
        nowMinutes={nowMinutes}
        startHour={startHour}
        endHour={endHour}
        roomMeta={roomMeta}
        onRoomSelect={(roomId) => onRoomSelect(roomId, todayDateKey)}
      />
    );
  }

  if (view === "finder") {
    return (
      <BookingFinder
        rooms={rooms}
        lessons={lessons}
        reservationMap={reservationMap}
        startHour={startHour}
        endHour={endHour}
        roomMeta={roomMeta}
        getLessonsForDate={getLessonsForDate}
        onReserve={onReserve}
        onOpenSchedule={(roomId, dateKey) => onRoomSelect(roomId, dateKey)}
        onDateWindowChange={onFinderDateWindowChange}
      />
    );
  }

  if (view === "mySchedule") {
    return (
      <MyScheduleView
        mode={myScheduleMode}
        onModeChange={onMyScheduleModeChange}
        selectedDate={selectedDate}
        onSelectedDateChange={onSelectedDateChange}
        agendaDays={myScheduleAgendaDays}
        onAgendaLoadMore={onMyScheduleAgendaLoadMore}
        todayDateKey={todayDateKey}
        weekDates={weekDates}
        timeSlots={timeSlots}
        startHour={startHour}
        endHour={endHour}
        rooms={rooms}
        reservationMap={reservationMap}
        currentUser={currentUser}
        pins={pins}
        onEditReservation={onEditReservation}
        getScheduleLessonsForDate={getLessonsForDate}
        onOpenPinned={onOpenPinned}
      />
    );
  }

  return (
    <ScheduleGrid
      view={allRooms ? "daily" : "room"}
      rooms={rooms}
      weekDates={view === "room" ? roomDates : weekDates}
      timeSlots={timeSlots}
      selectedDate={selectedDate}
      selectedDayKey={selectedDayKey}
      selectedRoom={selectedRoom}
      lessons={lessons}
      roomMeta={roomMeta}
      getLessonsForDate={getLessonsForDate}
      reservationMap={reservationMap}
      currentUser={currentUser}
      onReserve={onReserve}
      onRelease={onRelease}
      onEditReservation={onEditReservation}
      onLessonDetails={onLessonDetails}
      onSpecialDetails={onSpecialDetails}
      onClosedDetails={onClosedDetails}
      onAdminSlotClick={onAdminSlotClick}
      onAdminLessonClick={onAdminLessonClick}
      onAdminReservationClick={onAdminReservationClick}
      onReservationClick={onReservationClick}
      adminMode={adminMode}
      startHour={startHour}
      endHour={endHour}
      compact={allRooms || roomMode === "week"}
      compactLabel={allRooms ? "status" : "title"}
      onRoomSelect={allRooms ? onRoomSelect : undefined}
      onDateSelect={roomMode === "week" ? onDateSelect : undefined}
      showHeaders={allRooms || roomMode === "week"}
      footer={<Legend />}
      nowMinutes={nowMinutes}
      todayDateKey={todayDateKey}
    />
  );
}

