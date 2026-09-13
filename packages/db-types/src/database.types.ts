export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assignments: {
        Row: {
          bid_id: string
          created_at: string
          escrow_minor: number
          id: string
          payout_mode: Database["public"]["Enums"]["payout_mode"]
          status: Database["public"]["Enums"]["assignment_status"]
          task_id: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          bid_id: string
          created_at?: string
          escrow_minor: number
          id?: string
          payout_mode?: Database["public"]["Enums"]["payout_mode"]
          status?: Database["public"]["Enums"]["assignment_status"]
          task_id: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          bid_id?: string
          created_at?: string
          escrow_minor?: number
          id?: string
          payout_mode?: Database["public"]["Enums"]["payout_mode"]
          status?: Database["public"]["Enums"]["assignment_status"]
          task_id?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      bids: {
        Row: {
          created_at: string
          id: string
          is_locked: boolean
          message: string | null
          price_minor: number
          task_id: string
          time_limit_minutes: number
          worker_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_locked?: boolean
          message?: string | null
          price_minor: number
          task_id: string
          time_limit_minutes: number
          worker_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_locked?: boolean
          message?: string | null
          price_minor?: number
          task_id?: string
          time_limit_minutes?: number
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellations_log: {
        Row: {
          cancelled_by: Database["public"]["Enums"]["cancelled_by"]
          created_at: string
          id: string
          locked_minor: number | null
          penalty_or_refund_minor: number | null
          phase: string
          reason: Database["public"]["Enums"]["cancel_reason"]
          task_id: string
        }
        Insert: {
          cancelled_by: Database["public"]["Enums"]["cancelled_by"]
          created_at?: string
          id?: string
          locked_minor?: number | null
          penalty_or_refund_minor?: number | null
          phase: string
          reason?: Database["public"]["Enums"]["cancel_reason"]
          task_id: string
        }
        Update: {
          cancelled_by?: Database["public"]["Enums"]["cancelled_by"]
          created_at?: string
          id?: string
          locked_minor?: number | null
          penalty_or_refund_minor?: number | null
          phase?: string
          reason?: Database["public"]["Enums"]["cancel_reason"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellations_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          loc_label: string | null
          loc_lat: number | null
          loc_lng: number | null
          poster_rating_avg: number
          poster_rating_count: number
          skills: string[]
          updated_at: string
          worker_rating_avg: number
          worker_rating_count: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          loc_label?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          poster_rating_avg?: number
          poster_rating_count?: number
          skills?: string[]
          updated_at?: string
          worker_rating_avg?: number
          worker_rating_count?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          loc_label?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          poster_rating_avg?: number
          poster_rating_count?: number
          skills?: string[]
          updated_at?: string
          worker_rating_avg?: number
          worker_rating_count?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          about_role: Database["public"]["Enums"]["app_role"]
          author_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          subject_id: string
          task_id: string
        }
        Insert: {
          about_role: Database["public"]["Enums"]["app_role"]
          author_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          subject_id: string
          task_id: string
        }
        Update: {
          about_role?: Database["public"]["Enums"]["app_role"]
          author_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          subject_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tasks: {
        Row: {
          auto_complete_at: string | null
          benchmark_minor: number
          clear_at: string | null
          completed_at: string | null
          created_at: string
          description: string
          flag: Database["public"]["Enums"]["task_flag"]
          id: string
          loc_label: string | null
          loc_lat: number | null
          loc_lng: number | null
          locked_bid_id: string | null
          locked_minor: number | null
          media_kind: string | null
          media_path: string | null
          media_seconds: number | null
          payout_mode: Database["public"]["Enums"]["payout_mode"] | null
          pillar: Database["public"]["Enums"]["pillar"]
          poster_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          time_limit_minutes: number
          title: string
          updated_at: string
          work_done_at: string | null
        }
        Insert: {
          auto_complete_at?: string | null
          benchmark_minor: number
          clear_at?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string
          flag?: Database["public"]["Enums"]["task_flag"]
          id?: string
          loc_label?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          locked_bid_id?: string | null
          locked_minor?: number | null
          media_kind?: string | null
          media_path?: string | null
          media_seconds?: number | null
          payout_mode?: Database["public"]["Enums"]["payout_mode"] | null
          pillar: Database["public"]["Enums"]["pillar"]
          poster_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_limit_minutes: number
          title: string
          updated_at?: string
          work_done_at?: string | null
        }
        Update: {
          auto_complete_at?: string | null
          benchmark_minor?: number
          clear_at?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string
          flag?: Database["public"]["Enums"]["task_flag"]
          id?: string
          loc_label?: string | null
          loc_lat?: number | null
          loc_lng?: number | null
          locked_bid_id?: string | null
          locked_minor?: number | null
          media_kind?: string | null
          media_path?: string | null
          media_seconds?: number | null
          payout_mode?: Database["public"]["Enums"]["payout_mode"] | null
          pillar?: Database["public"]["Enums"]["pillar"]
          poster_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_limit_minutes?: number
          title?: string
          updated_at?: string
          work_done_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance_minor: number
          clearing_minor: number
          currency: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_minor?: number
          clearing_minor?: number
          currency?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_minor?: number
          clearing_minor?: number
          currency?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "poster" | "worker"
      assignment_status: "assigned" | "started" | "released" | "refunded"
      cancel_reason: "normal" | "overdue"
      cancelled_by: "poster" | "worker"
      payout_mode: "one_time" | "milestones"
      pillar: "services" | "procurement" | "local_intel"
      task_flag: "none" | "urgent" | "unique"
      task_status:
        | "OPEN"
        | "LOCKED"
        | "TASK_STARTED"
        | "OVERDUE"
        | "WORK_DONE"
        | "REVISION_REQUESTED"
        | "COMPLETED"
        | "AUTO_COMPLETED"
        | "CANCELLED"
        | "DISPUTED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "poster", "worker"],
      assignment_status: ["assigned", "started", "released", "refunded"],
      cancel_reason: ["normal", "overdue"],
      cancelled_by: ["poster", "worker"],
      payout_mode: ["one_time", "milestones"],
      pillar: ["services", "procurement", "local_intel"],
      task_flag: ["none", "urgent", "unique"],
      task_status: [
        "OPEN",
        "LOCKED",
        "TASK_STARTED",
        "OVERDUE",
        "WORK_DONE",
        "REVISION_REQUESTED",
        "COMPLETED",
        "AUTO_COMPLETED",
        "CANCELLED",
        "DISPUTED",
      ],
    },
  },
} as const
