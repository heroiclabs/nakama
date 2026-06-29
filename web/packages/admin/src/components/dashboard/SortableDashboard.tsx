import { type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardLayoutStore } from "@/stores/dashboard-layout-store";

const POINTER_ACTIVATION_DISTANCE = 6;

function useDashboardSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

function stopNestedDragBubble(event: ReactPointerEvent) {
  event.stopPropagation();
}

export function DragHandle({ className }: { className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Drag to reorder"
      className={cn(
        "inline-flex shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
}

function SortableItemInner({
  id,
  children,
  className,
  variant = "grid",
  nested = false,
  disabled = false,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  variant?: "grid" | "section";
  nested?: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const handleProps = {
    ...attributes,
    ...listeners,
    onPointerDown: (event: ReactPointerEvent) => {
      listeners?.onPointerDown?.(event);
      if (nested) stopNestedDragBubble(event);
    },
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (variant === "section" && !disabled) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn("flex w-full items-center gap-2", isDragging && "z-30 opacity-90", className)}
      >
        <div className="shrink-0 pt-0.5" {...handleProps}>
          <DragHandle />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/sortable relative min-w-0 w-full",
        isDragging && "z-30",
        className,
      )}
    >
      {!disabled && (
        <div className="absolute right-2 top-2 z-30" {...handleProps}>
          <DragHandle />
        </div>
      )}
      <div className={cn("min-w-0 w-full", isDragging && "opacity-80")}>{children}</div>
    </div>
  );
}

function StaticGridItem({ children }: { children: ReactNode }) {
  return <div className="min-w-0 w-full">{children}</div>;
}

export function SortableVerticalList<T extends string>({
  contextId,
  items,
  onReorder,
  editMode,
  className,
  renderItem,
}: {
  contextId: string;
  items: T[];
  onReorder: (next: T[]) => void;
  editMode: boolean;
  className?: string;
  renderItem: (id: T) => ReactNode;
}) {
  const sensors = useDashboardSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(active.id as T);
    const newIndex = items.indexOf(over.id as T);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  if (!editMode) {
    return (
      <div className={className}>
        {items.map((id) => (
          <StaticGridItem key={id}>{renderItem(id)}</StaticGridItem>
        ))}
      </div>
    );
  }

  return (
    <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((id) => (
            <SortableItemInner key={id} id={id} variant="section">
              {renderItem(id)}
            </SortableItemInner>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function SortableGrid<T extends string>({
  contextId,
  items,
  onReorder,
  editMode,
  className,
  renderItem,
}: {
  contextId: string;
  items: T[];
  onReorder: (next: T[]) => void;
  editMode: boolean;
  className?: string;
  renderItem: (id: T) => ReactNode;
}) {
  const sensors = useDashboardSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(active.id as T);
    const newIndex = items.indexOf(over.id as T);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  if (!editMode) {
    return (
      <div className={className}>
        {items.map((id) => (
          <StaticGridItem key={id}>{renderItem(id)}</StaticGridItem>
        ))}
      </div>
    );
  }

  return (
    <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className={className}>
          {items.map((id) => (
            <SortableItemInner key={id} id={id} variant="grid" nested>
              {renderItem(id)}
            </SortableItemInner>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function DashboardLayoutToolbar() {
  const editMode = useDashboardLayoutStore((s) => s.layoutEditMode);
  const setLayoutEditMode = useDashboardLayoutStore((s) => s.setLayoutEditMode);
  const resetStatusLayout = useDashboardLayoutStore((s) => s.resetStatusLayout);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setLayoutEditMode(!editMode)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
          editMode
            ? "border-primary bg-primary/10 text-primary"
            : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
        )}
      >
        <GripVertical className="h-4 w-4" />
        {editMode ? "Done arranging" : "Customize layout"}
      </button>
      {editMode && (
        <button
          type="button"
          onClick={resetStatusLayout}
          className="inline-flex items-center rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Reset to default
        </button>
      )}
    </div>
  );
}

export function useStatusLayoutEditMode() {
  return useDashboardLayoutStore((s) => s.layoutEditMode);
}
