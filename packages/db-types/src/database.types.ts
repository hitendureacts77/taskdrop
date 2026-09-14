export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
      auth_codes: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          phone: string
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at: string
          phone: string
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          phone?: string
        }
        Relationships: []
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
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          task_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          task_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          created_at: string
          id: string
          link_url: string | null
          paid_at: string | null
          provider: string
          provider_ref: string | null
          purpose: Database["public"]["Enums"]["payment_purpose"]
          status: Database["public"]["Enums"]["payment_status"]
          task_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          id?: string
          link_url?: string | null
          paid_at?: string | null
          provider?: string
          provider_ref?: string | null
          purpose: Database["public"]["Enums"]["payment_purpose"]
          status?: Database["public"]["Enums"]["payment_status"]
          task_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          id?: string
          link_url?: string | null
          paid_at?: string | null
          provider?: string
          provider_ref?: string | null
          purpose?: Database["public"]["Enums"]["payment_purpose"]
          status?: Database["public"]["Enums"]["payment_status"]
          task_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_minor: number
          created_at: string
          destination: string | null
          failure_note: string | null
          id: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          destination?: string | null
          failure_note?: string | null
          id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          destination?: string | null
          failure_note?: string | null
          id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          onboarded_at: string | null
          payout_upi: string | null
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
          onboarded_at?: string | null
          payout_upi?: string | null
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
          onboarded_at?: string | null
          payout_upi?: string | null
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
      confirm_release: {
        Args: { p_task_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_bid: {
        Args: {
          p_bid_id: string
          p_payout_mode?: Database["public"]["Enums"]["payout_mode"]
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_work_done: {
        Args: { p_task_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_dispute: {
        Args: { p_reason?: string; p_task_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_revision: {
        Args: { p_note?: string; p_task_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_withdrawal: {
        Args: { p_amount_minor: number; p_destination?: string }
        Returns: {
          amount_minor: number
          created_at: string
          destination: string | null
          failure_note: string | null
          id: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_task: {
        Args: { p_task_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_review: {
        Args: { p_comment?: string; p_rating: number; p_task_id: string }
        Returns: {
          about_role: Database["public"]["Enums"]["app_role"]
          author_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          subject_id: string
          task_id: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "poster" | "worker"
      assignment_status: "assigned" | "started" | "released" | "refunded"
      cancel_reason: "normal" | "overdue"
      cancelled_by: "poster" | "worker"
      payment_purpose: "escrow" | "topup"
      payment_status: "created" | "paid" | "failed" | "cancelled"
      payout_mode: "one_time" | "milestones"
      payout_status: "requested" | "paid" | "failed"
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "poster", "worker"],
      assignment_status: ["assigned", "started", "released", "refunded"],
      cancel_reason: ["normal", "overdue"],
      cancelled_by: ["poster", "worker"],
      payment_purpose: ["escrow", "topup"],
      payment_status: ["created", "paid", "failed", "cancelled"],
      payout_mode: ["one_time", "milestones"],
      payout_status: ["requested", "paid", "failed"],
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
