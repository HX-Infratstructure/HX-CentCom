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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      engineering_tasks: {
        Row: {
          agent: string
          blocked_on: string
          commit_sha: string
          due_date: string
          host: string
          id: string
          note: string
          progress: number
          repository: string
          source_url: string
          start_date: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agent: string
          blocked_on?: string
          commit_sha?: string
          due_date: string
          host: string
          id: string
          note?: string
          progress?: number
          repository: string
          source_url?: string
          start_date: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agent?: string
          blocked_on?: string
          commit_sha?: string
          due_date?: string
          host?: string
          id?: string
          note?: string
          progress?: number
          repository?: string
          source_url?: string
          start_date?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      github_prs: {
        Row: {
          draft: boolean
          fetched_at: string
          head_sha: string
          id: number
          merge_commit_sha: string | null
          number: number
          repo: string
          state: string
          title: string
          url: string
        }
        Insert: {
          draft?: boolean
          fetched_at?: string
          head_sha: string
          id: number
          merge_commit_sha?: string | null
          number: number
          repo: string
          state: string
          title: string
          url: string
        }
        Update: {
          draft?: boolean
          fetched_at?: string
          head_sha?: string
          id?: number
          merge_commit_sha?: string | null
          number?: number
          repo?: string
          state?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      github_repos: {
        Row: {
          default_branch: string
          fetched_at: string
          head_sha: string
          name: string
        }
        Insert: {
          default_branch: string
          fetched_at?: string
          head_sha: string
          name: string
        }
        Update: {
          default_branch?: string
          fetched_at?: string
          head_sha?: string
          name?: string
        }
        Relationships: []
      }
      owner_decisions: {
        Row: {
          blocks: string[]
          decided_at: string | null
          decision_source_url: string | null
          decision_text: string | null
          gate_type: string
          id: string
          options: Json
          question: string
          requested_at: string
          requested_by: string
          status: string
          subject: string
          superseded_by: string | null
        }
        Insert: {
          blocks?: string[]
          decided_at?: string | null
          decision_source_url?: string | null
          decision_text?: string | null
          gate_type: string
          id: string
          options?: Json
          question: string
          requested_at?: string
          requested_by: string
          status?: string
          subject: string
          superseded_by?: string | null
        }
        Update: {
          blocks?: string[]
          decided_at?: string | null
          decision_source_url?: string | null
          decision_text?: string | null
          gate_type?: string
          id?: string
          options?: Json
          question?: string
          requested_at?: string
          requested_by?: string
          status?: string
          subject?: string
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_decisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "owner_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_editors: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_editors: {
        Row: {
          agent: string | null
          created_at: string
          user_id: string
        }
        Insert: {
          agent?: string | null
          created_at?: string
          user_id: string
        }
        Update: {
          agent?: string | null
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_requirements: {
        Row: {
          created_at: string
          id: string
          proof_url: string
          requirement: string
          source_url: string
          state: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          proof_url?: string
          requirement: string
          source_url?: string
          state?: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          proof_url?: string
          requirement?: string
          source_url?: string
          state?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_requirements_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "engineering_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_updates: {
        Row: {
          agent: string
          created_at: string
          editor_id: string | null
          id: string
          note: string
          progress: number
          status: string
          task_id: string
        }
        Insert: {
          agent: string
          created_at?: string
          editor_id?: string | null
          id?: string
          note: string
          progress: number
          status: string
          task_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          editor_id?: string | null
          id?: string
          note?: string
          progress?: number
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "engineering_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
