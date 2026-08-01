import ScheduleGrid from "./views/ScheduleGrid";
import Legend from "./views/Legend";
import LiveView from "./views/LiveView";
import BookingFinder from "./views/BookingFinder";
import MyScheduleView from "./views/MyScheduleView";
import GroupsView from "./views/GroupsView";
import type { WeekDate } from "../../lib/date";
import type { DayKey, Lesson, Room, TimeSlot } from "../../types/schedule";
import type { ReservationMap, ReserveRequest } from "../../types/reservations";
import type { User } from "../../types/auth";
import type { MySchedulePin } from "../../types/mySchedule";
import type { DirectoryUser, RoomMeta } from "../../types/admin";
import type { ViewMode } from "../../types/ui";
import type { ReactNode } from "react";
import { isReservationPolicySlotAllowed } from "../../lib/reservationPolicyWindows";
import type { ReservationPolicyWindow } from "../../lib/reservationPolicyWindows";
import type {
  AvailabilityDateOffs,
  CollaborationGroup,
  CollaboratorEvent,
  GroupRehearsal,
  RehearsalParticipant,
  UserAvailability
} from "../../types/collaboration";

export type HomeViewRouterProps = {
  view: ViewMode;
  collaborationEnabled?: boolean;
  groupsEnabled?: boolean;
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
  availability: UserAvailability;
  groups: CollaborationGroup[];
  collaboratorProfiles: Array<{
    email: string;
    name: string;
    availability: UserAvailability;
    dateOffs: AvailabilityDateOffs;
    events: CollaboratorEvent[];
  }>;
  finderPrefilledGroupId?: string;
  onFinderSchedule: (selection: {
    dateKey: string;
    dayKey: DayKey;
    startMinutes: number;
    endMinutes: number;
    preferredDurationMinutes?: number;
    roomId?: string;
    groupId?: string;
    mode: { findCommonTime: boolean; findRoom: boolean };
    participantEmails: string[];
  }) => void;
  onCreateGroup: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  finderPolicyMaxDurationMinutes?: number;
  finderPolicyMaxDaysForward?: number;
  finderPrefilledPeopleEmails?: string[];
  onFinderPeopleSelectionChange?: (participantEmails: string[]) => void;

  // My schedule
  myScheduleMode: "day" | "week" | "agenda";
  onMyScheduleModeChange: (mode: "day" | "week" | "agenda") => void;
  myScheduleAgendaDays: number;
  onMyScheduleAgendaLoadMore: () => void;
  pins: MySchedulePin[];
  onOpenPinned: (pin: MySchedulePin) => void;
  onMyScheduleAddSlot: (request: ReserveRequest) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onAvailabilityDayUpdate: (
    dayKey: DayKey,
    updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>
  ) => void;
  availabilityDateOffs: AvailabilityDateOffs;
  onAvailabilityDateOffToggle: (dateKey: string, off: boolean) => void;
  availabilityEditMode: boolean;

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
  onExamDetails: (reservationId: string, dateKey: string) => void;
  onClosedDetails: (reservationId: string, dateKey: string) => void;
  pendingReservationIds?: string[];
  onAdminSlotClick: (request: ReserveRequest) => void;
  onAdminLessonClick: (lessonId: string, dateKey: string) => void;
  onAdminReservationClick: (reservationId: string, dateKey: string) => void;
  onReservationClick: (reservationId: string, dateKey: string) => void;

  // Swipe navigation
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  roomZoomResetToken?: number;
  myScheduleZoomResetToken?: number;

  // Groups view
  currentEmail?: string;
  directoryUsers: DirectoryUser[];
  pendingInvites: CollaborationGroup[];
  onGroupCreate: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  onGroupInvite: (groupId: string, email: string) => void;
  onGroupInviteResponse: (groupId: string, accept: boolean) => void;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupEdit: (groupId: string, payload: { name: string; memberEmails: string[] }) => Promise<void> | void;
  onGroupDelete: (groupId: string) => void;
  onGroupLeave: (groupId: string) => void;
  onGroupRemoveMember: (groupId: string, email: string) => void;
  onAddGroupRehearsal: (groupId: string, rehearsal: GroupRehearsal) => Promise<void> | void;
  onDeleteGroupRehearsal: (
    groupId: string,
    rehearsalId: string,
    options?: { releaseLinkedReservation?: boolean }
  ) => Promise<void> | void;
  onRespondToGroupRehearsal: (
    groupId: string,
    rehearsalId: string,
    status: RehearsalParticipant["status"]
  ) => void;
  onOpenFinderForGroup: (groupId: string) => void;
  onOpenFinderForPeople?: (participantEmails: string[]) => void;
  getAvailableRoomsForSlot: (input: {
    dateKey: string;
    dayKey: DayKey;
    startMinutes: number;
    durationMinutes: number;
    excludeReservationId?: string;
  }) => { id: string; name: string }[];
  policyDayKeys: DayKey[];
  policyWindows: ReservationPolicyWindow[];
  onGroupsTopBarChange?: (context: { title: string; subtitle?: ReactNode | string | null; key: string }) => void;
  finderResetToken?: number;
  groupsResetToken?: number;
};

export default function HomeViewRouter({
  view,
  collaborationEnabled = false,
  groupsEnabled = false,
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
  availability,
  groups,
  collaboratorProfiles,
  finderPrefilledGroupId,
  onFinderSchedule,
  onCreateGroup,
  finderPolicyMaxDurationMinutes,
  finderPolicyMaxDaysForward,
  finderPrefilledPeopleEmails = [],
  onFinderPeopleSelectionChange,
  myScheduleMode,
  onMyScheduleModeChange,
  myScheduleAgendaDays,
  onMyScheduleAgendaLoadMore,
  pins,
  onOpenPinned,
  onMyScheduleAddSlot,
  onSelectedDateChange,
  onAvailabilityDayUpdate,
  availabilityDateOffs,
  onAvailabilityDateOffToggle,
  availabilityEditMode,
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
  onExamDetails,
  onClosedDetails,
  pendingReservationIds,
  onAdminSlotClick,
  onAdminLessonClick,
  onAdminReservationClick,
  onReservationClick,
  onNavigatePrev,
  onNavigateNext,
  roomZoomResetToken = 0,
  myScheduleZoomResetToken = 0,
  adminMode,
  allRooms,
  roomMode,
  onRoomSelect,
  onDateSelect,
  currentEmail,
  directoryUsers,
  pendingInvites,
  onGroupCreate,
  onGroupInvite,
  onGroupInviteResponse,
  onGroupRename,
  onGroupEdit,
  onGroupDelete,
  onGroupLeave,
  onGroupRemoveMember,
  onAddGroupRehearsal,
  onDeleteGroupRehearsal,
  onRespondToGroupRehearsal,
  getAvailableRoomsForSlot,
  policyDayKeys,
  policyWindows,
  onOpenFinderForGroup,
  onOpenFinderForPeople,
  onGroupsTopBarChange,
  finderResetToken,
  groupsResetToken
}: HomeViewRouterProps) {
  const isFinderView = view === "finder";
  const isGroupsView = collaborationEnabled && view === "groups";

  const finderView = (
    <BookingFinder
      rooms={rooms}
      lessons={lessons}
      reservationMap={reservationMap}
      startHour={startHour}
      endHour={endHour}
      roomMeta={roomMeta}
      getLessonsForDate={getLessonsForDate}
      onOpenSchedule={(roomId, dateKey) => onRoomSelect(roomId, dateKey)}
      onDateWindowChange={onFinderDateWindowChange}
      availability={availability}
      groups={groupsEnabled ? groups : []}
      collaborators={collaboratorProfiles}
      directoryUsers={directoryUsers}
      currentEmail={currentEmail}
      collaborationEnabled={collaborationEnabled}
      groupsEnabled={groupsEnabled}
      policyMaxDurationMinutes={finderPolicyMaxDurationMinutes}
      policyMaxDaysForward={finderPolicyMaxDaysForward}
      policyDayKeys={policyDayKeys}
      policyWindows={policyWindows}
      prefilledGroupId={groupsEnabled ? finderPrefilledGroupId : ""}
      prefilledPeopleEmails={finderPrefilledPeopleEmails}
      isActive={isFinderView}
      resetToken={finderResetToken}
      onCreateGroup={onCreateGroup}
      onPeopleSelectionChange={onFinderPeopleSelectionChange}
      onSchedule={onFinderSchedule}
    />
  );

  const groupsView = (
    <GroupsView
      currentEmail={currentEmail}
      users={directoryUsers}
      rooms={rooms}
      groups={groups}
      prefilledGroupId={finderPrefilledGroupId}
      pendingInvites={pendingInvites}
      onCreateGroup={onGroupCreate}
      onInviteUser={onGroupInvite}
      onRespondToInvite={onGroupInviteResponse}
      onRenameGroup={onGroupRename}
      onEditGroup={onGroupEdit}
      onDeleteGroup={onGroupDelete}
      onLeaveGroup={onGroupLeave}
      onRemoveMember={onGroupRemoveMember}
      onAddRehearsal={onAddGroupRehearsal}
      onDeleteRehearsal={onDeleteGroupRehearsal}
      onRespondToRehearsal={onRespondToGroupRehearsal}
      getAvailableRoomsForSlot={getAvailableRoomsForSlot}
      policyDayKeys={policyDayKeys}
      onOpenFinderForGroup={onOpenFinderForGroup}
      groupsEnabled={groupsEnabled}
      onOpenFinderForPeople={onOpenFinderForPeople}
      onTopBarChange={onGroupsTopBarChange}
      isActive={isGroupsView}
      resetToken={groupsResetToken}
    />
  );

  let mainView: ReactNode = null;
  if (view === "live") {
    mainView = (
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
        policyDayKeys={policyDayKeys}
        policyWindows={policyWindows}
        onRoomSelect={(roomId) => onRoomSelect(roomId, todayDateKey)}
      />
    );
  } else if (view === "mySchedule") {
    mainView = (
      <MyScheduleView
        mode={myScheduleMode}
        onModeChange={onMyScheduleModeChange}
        selectedDate={selectedDate}
        onSelectedDateChange={onSelectedDateChange}
        agendaDays={myScheduleAgendaDays}
        onAgendaLoadMore={onMyScheduleAgendaLoadMore}
        todayDateKey={todayDateKey}
        nowMinutes={nowMinutes}
        weekDates={weekDates}
        timeSlots={timeSlots}
        startHour={startHour}
        endHour={endHour}
        rooms={rooms}
        groups={groups}
        directoryUsers={directoryUsers}
        reservationMap={reservationMap}
        currentUser={currentUser}
        pins={pins}
        onEditReservation={onEditReservation}
        onReservationDetails={onReservationClick}
        getScheduleLessonsForDate={getLessonsForDate}
        onOpenPinned={onOpenPinned}
        onAddSlot={onMyScheduleAddSlot}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        zoomResetToken={myScheduleZoomResetToken}
        pendingReservationIds={pendingReservationIds}
        availability={availability}
        onAvailabilityDayUpdate={onAvailabilityDayUpdate}
        availabilityDateOffs={availabilityDateOffs}
        onAvailabilityDateOffToggle={onAvailabilityDateOffToggle}
        availabilityEditMode={availabilityEditMode}
        onLinkedRehearsalRespond={collaborationEnabled ? onRespondToGroupRehearsal : undefined}
      />
    );
  } else if (!isFinderView && !isGroupsView) {
    mainView = (
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
        directoryUsers={directoryUsers}
        groups={groups}
        getLessonsForDate={getLessonsForDate}
        reservationMap={reservationMap}
        currentUser={currentUser}
        onReserve={onReserve}
        onRelease={onRelease}
        onEditReservation={onEditReservation}
        onLessonDetails={onLessonDetails}
        onSpecialDetails={onSpecialDetails}
        onExamDetails={onExamDetails}
        onClosedDetails={onClosedDetails}
        pendingReservationIds={pendingReservationIds}
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
        isSlotReservable={(request) =>
          isReservationPolicySlotAllowed(policyWindows, {
            dateKey: request.date,
            dayKey: request.day,
            roomId: request.roomId,
            startMinutes: request.time,
            endMinutes: request.time + (request.durationMinutes || 30)
          })
        }
        footer={<Legend />}
        nowMinutes={nowMinutes}
        todayDateKey={todayDateKey}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        zoomResetToken={roomZoomResetToken}
        onLinkedRehearsalRespond={collaborationEnabled ? onRespondToGroupRehearsal : undefined}
      />
    );
  }

  return (
    <>
      <div
        style={{
          display: isFinderView || isGroupsView ? "none" : "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          flexDirection: "column"
        }}
      >
        {mainView}
      </div>
      <div
        style={{
          display: isFinderView ? "flex" : "none",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          flexDirection: "column"
        }}
      >
        {finderView}
      </div>
      <div
        style={{
          display: isGroupsView ? "flex" : "none",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          flexDirection: "column"
        }}
      >
        {groupsView}
      </div>
    </>
  );
}
