export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_relationships: {
        Row: {
          account_a_id: string
          account_b_id: string
          created_at: string
          created_by: string | null
          id: string
          last_confirmed_at: string | null
          notes: string | null
          org_id: string
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          status: Database["public"]["Enums"]["relationship_state"]
          strength: Database["public"]["Enums"]["relationship_strength"] | null
          updated_at: string
        }
        Insert: {
          account_a_id: string
          account_b_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_confirmed_at?: string | null
          notes?: string | null
          org_id: string
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          status?: Database["public"]["Enums"]["relationship_state"]
          strength?: Database["public"]["Enums"]["relationship_strength"] | null
          updated_at?: string
        }
        Update: {
          account_a_id?: string
          account_b_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_confirmed_at?: string | null
          notes?: string | null
          org_id?: string
          relationship_type?: Database["public"]["Enums"]["relationship_type"]
          status?: Database["public"]["Enums"]["relationship_state"]
          strength?: Database["public"]["Enums"]["relationship_strength"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          city: string | null
          created_at: string
          display_last_verified_at: string | null
          has_display_wall: boolean
          id: string
          lead_source: string
          name: string
          org_id: string
          owner_id: string
          parent_account_id: string | null
          referring_account_id: string | null
          relationship_status:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          source_detail: string | null
          state: string | null
          strategic_importance:
            | Database["public"]["Enums"]["strategic_importance"]
            | null
          territory_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          address?: string | null
          city?: string | null
          created_at?: string
          display_last_verified_at?: string | null
          has_display_wall?: boolean
          id?: string
          lead_source: string
          name: string
          org_id: string
          owner_id: string
          parent_account_id?: string | null
          referring_account_id?: string | null
          relationship_status?:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          source_detail?: string | null
          state?: string | null
          strategic_importance?:
            | Database["public"]["Enums"]["strategic_importance"]
            | null
          territory_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          address?: string | null
          city?: string | null
          created_at?: string
          display_last_verified_at?: string | null
          has_display_wall?: boolean
          id?: string
          lead_source?: string
          name?: string
          org_id?: string
          owner_id?: string
          parent_account_id?: string | null
          referring_account_id?: string | null
          relationship_status?:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          source_detail?: string | null
          state?: string | null
          strategic_importance?:
            | Database["public"]["Enums"]["strategic_importance"]
            | null
          territory_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          commercial_potential: string | null
          created_at: string
          follow_up_required: boolean
          id: string
          key_information: string | null
          location: string | null
          objective: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail: string | null
          occurred_at: string
          opportunity_id: string | null
          org_id: string
          outcomes: Database["public"]["Enums"]["activity_outcome"][]
          owner_id: string
          planned_action_id: string | null
          primary_account_id: string
          purpose: string | null
          updated_at: string
          was_planned: boolean
          what_happened: string | null
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          commercial_potential?: string | null
          created_at?: string
          follow_up_required?: boolean
          id?: string
          key_information?: string | null
          location?: string | null
          objective?: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          org_id: string
          outcomes?: Database["public"]["Enums"]["activity_outcome"][]
          owner_id: string
          planned_action_id?: string | null
          primary_account_id: string
          purpose?: string | null
          updated_at?: string
          was_planned?: boolean
          what_happened?: string | null
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["activity_type"]
          commercial_potential?: string | null
          created_at?: string
          follow_up_required?: boolean
          id?: string
          key_information?: string | null
          location?: string | null
          objective?: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          org_id?: string
          outcomes?: Database["public"]["Enums"]["activity_outcome"][]
          owner_id?: string
          planned_action_id?: string | null
          primary_account_id?: string
          purpose?: string | null
          updated_at?: string
          was_planned?: boolean
          what_happened?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_accounts: {
        Row: {
          account_id: string
          activity_id: string
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["activity_account_role"]
          updated_at: string
        }
        Insert: {
          account_id: string
          activity_id: string
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["activity_account_role"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          activity_id?: string
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["activity_account_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_accounts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_contacts: {
        Row: {
          activity_id: string
          contact_id: string
          created_at: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          activity_id: string
          contact_id: string
          created_at?: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          activity_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_contacts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_candidates: {
        Row: {
          created_at: string
          created_by: string
          extracted: Json
          id: string
          matched_account_id: string | null
          matched_contact_id: string | null
          org_id: string
          raw_ref: string | null
          resolved_at: string | null
          source: Database["public"]["Enums"]["candidate_source"]
          status: Database["public"]["Enums"]["candidate_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          extracted?: Json
          id?: string
          matched_account_id?: string | null
          matched_contact_id?: string | null
          org_id: string
          raw_ref?: string | null
          resolved_at?: string | null
          source: Database["public"]["Enums"]["candidate_source"]
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          extracted?: Json
          id?: string
          matched_account_id?: string | null
          matched_contact_id?: string | null
          org_id?: string
          raw_ref?: string | null
          resolved_at?: string | null
          source?: Database["public"]["Enums"]["candidate_source"]
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_contact_id_fkey"
            columns: ["matched_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_candidates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          created_at: string
          email: string | null
          id: string
          influence_level: Database["public"]["Enums"]["influence_level"] | null
          is_champion: boolean
          job_title: string | null
          name: string
          org_id: string
          phone: string | null
          relationship_status:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          email?: string | null
          id?: string
          influence_level?:
            | Database["public"]["Enums"]["influence_level"]
            | null
          is_champion?: boolean
          job_title?: string | null
          name: string
          org_id: string
          phone?: string | null
          relationship_status?:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          email?: string | null
          id?: string
          influence_level?:
            | Database["public"]["Enums"]["influence_level"]
            | null
          is_champion?: boolean
          job_title?: string | null
          name?: string
          org_id?: string
          phone?: string | null
          relationship_status?:
            | Database["public"]["Enums"]["relationship_status_value"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachments: {
        Row: {
          classification:
            | Database["public"]["Enums"]["attachment_classification"]
            | null
          created_at: string
          filename: string | null
          id: string
          linked_opportunity_id: string | null
          linked_project_id: string | null
          message_id: string
          mime_type: string | null
          org_id: string
          sha256: string
          size_bytes: number | null
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          classification?:
            | Database["public"]["Enums"]["attachment_classification"]
            | null
          created_at?: string
          filename?: string | null
          id?: string
          linked_opportunity_id?: string | null
          linked_project_id?: string | null
          message_id: string
          mime_type?: string | null
          org_id: string
          sha256: string
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          classification?:
            | Database["public"]["Enums"]["attachment_classification"]
            | null
          created_at?: string
          filename?: string | null
          id?: string
          linked_opportunity_id?: string | null
          linked_project_id?: string | null
          message_id?: string
          mime_type?: string | null
          org_id?: string
          sha256?: string
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_ref: string | null
          cc_addrs: string[]
          created_at: string
          direction: Database["public"]["Enums"]["email_direction"] | null
          from_addr: string | null
          gmail_message_id: string
          has_attachments: boolean
          id: string
          org_id: string
          sent_at: string | null
          snippet: string | null
          thread_id: string
          to_addrs: string[]
          updated_at: string
        }
        Insert: {
          body_ref?: string | null
          cc_addrs?: string[]
          created_at?: string
          direction?: Database["public"]["Enums"]["email_direction"] | null
          from_addr?: string | null
          gmail_message_id: string
          has_attachments?: boolean
          id?: string
          org_id: string
          sent_at?: string | null
          snippet?: string | null
          thread_id: string
          to_addrs?: string[]
          updated_at?: string
        }
        Update: {
          body_ref?: string | null
          cc_addrs?: string[]
          created_at?: string
          direction?: Database["public"]["Enums"]["email_direction"] | null
          from_addr?: string | null
          gmail_message_id?: string
          has_attachments?: boolean
          id?: string
          org_id?: string
          sent_at?: string | null
          snippet?: string | null
          thread_id?: string
          to_addrs?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_state: {
        Row: {
          created_at: string
          history_id: string | null
          id: string
          last_synced_at: string | null
          membership_id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          history_id?: string | null
          id?: string
          last_synced_at?: string | null
          membership_id: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          history_id?: string | null
          id?: string
          last_synced_at?: string | null
          membership_id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_state_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sync_state_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          created_at: string
          first_message_at: string | null
          gmail_thread_id: string
          id: string
          last_direction: Database["public"]["Enums"]["email_direction"] | null
          last_extracted_at: string | null
          last_message_at: string | null
          linked_opportunity_id: string | null
          linked_project_id: string | null
          matched_account_id: string | null
          matched_contact_id: string | null
          membership_id: string
          open_commitments: Json
          org_id: string
          participants: Json
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_message_at?: string | null
          gmail_thread_id: string
          id?: string
          last_direction?: Database["public"]["Enums"]["email_direction"] | null
          last_extracted_at?: string | null
          last_message_at?: string | null
          linked_opportunity_id?: string | null
          linked_project_id?: string | null
          matched_account_id?: string | null
          matched_contact_id?: string | null
          membership_id: string
          open_commitments?: Json
          org_id: string
          participants?: Json
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_message_at?: string | null
          gmail_thread_id?: string
          id?: string
          last_direction?: Database["public"]["Enums"]["email_direction"] | null
          last_extracted_at?: string | null
          last_message_at?: string | null
          linked_opportunity_id?: string | null
          linked_project_id?: string | null
          matched_account_id?: string | null
          matched_contact_id?: string | null
          membership_id?: string
          open_commitments?: Json
          org_id?: string
          participants?: Json
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_matched_contact_id_fkey"
            columns: ["matched_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          debrief_language: string
          id: string
          joined_at: string
          manager_id: string | null
          org_id: string
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          territory_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          debrief_language?: string
          id?: string
          joined_at?: string
          manager_id?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          territory_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          debrief_language?: string
          id?: string
          joined_at?: string
          manager_id?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          territory_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      next_actions: {
        Row: {
          account_id: string | null
          action: string
          activity_id: string | null
          calendar_event_id: string | null
          completed_at: string | null
          created_at: string
          due_date: string
          id: string
          objective: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail: string | null
          opportunity_id: string | null
          org_id: string
          owner_id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          action: string
          activity_id?: string | null
          calendar_event_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date: string
          id?: string
          objective?: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail?: string | null
          opportunity_id?: string | null
          org_id: string
          owner_id: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          action?: string
          activity_id?: string | null
          calendar_event_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          objective?: Database["public"]["Enums"]["visit_objective"] | null
          objective_detail?: string | null
          opportunity_id?: string | null
          org_id?: string
          owner_id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          alternative_product: string | null
          application: string | null
          architect_id: string | null
          builder_id: string | null
          competitor: string | null
          contractor_id: string | null
          created_at: string
          current_blocker: string | null
          current_status: string | null
          dealer_id: string | null
          developer_id: string | null
          distributor_id: string | null
          estimated_quantity: number | null
          estimated_revenue: number | null
          expected_close_date: string | null
          id: string
          lead_source: string
          name: string
          org_id: string
          owner_id: string
          primary_account_id: string
          probability: number | null
          product: string | null
          project_id: string | null
          quantity_unit: string | null
          referring_account_id: string | null
          risk: string | null
          source_detail: string | null
          stage: Database["public"]["Enums"]["opportunity_stage"]
          territory_id: string
          updated_at: string
        }
        Insert: {
          alternative_product?: string | null
          application?: string | null
          architect_id?: string | null
          builder_id?: string | null
          competitor?: string | null
          contractor_id?: string | null
          created_at?: string
          current_blocker?: string | null
          current_status?: string | null
          dealer_id?: string | null
          developer_id?: string | null
          distributor_id?: string | null
          estimated_quantity?: number | null
          estimated_revenue?: number | null
          expected_close_date?: string | null
          id?: string
          lead_source: string
          name: string
          org_id: string
          owner_id: string
          primary_account_id: string
          probability?: number | null
          product?: string | null
          project_id?: string | null
          quantity_unit?: string | null
          referring_account_id?: string | null
          risk?: string | null
          source_detail?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          territory_id: string
          updated_at?: string
        }
        Update: {
          alternative_product?: string | null
          application?: string | null
          architect_id?: string | null
          builder_id?: string | null
          competitor?: string | null
          contractor_id?: string | null
          created_at?: string
          current_blocker?: string | null
          current_status?: string | null
          dealer_id?: string | null
          developer_id?: string | null
          distributor_id?: string | null
          estimated_quantity?: number | null
          estimated_revenue?: number | null
          expected_close_date?: string | null
          id?: string
          lead_source?: string
          name?: string
          org_id?: string
          owner_id?: string
          primary_account_id?: string
          probability?: number | null
          product?: string | null
          project_id?: string | null
          quantity_unit?: string | null
          referring_account_id?: string | null
          risk?: string | null
          source_detail?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          territory_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      org_email_exclusions: {
        Row: {
          created_at: string
          id: string
          org_id: string
          pattern: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          pattern: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          pattern?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_email_exclusions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_integrations: {
        Row: {
          config: Json
          created_at: string
          credential_ref: string
          id: string
          last_verified_at: string | null
          org_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          credential_ref: string
          id?: string
          last_verified_at?: string | null
          org_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          credential_ref?: string
          id?: string
          last_verified_at?: string | null
          org_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
          workspace_domain: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
          workspace_domain?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
          workspace_domain?: string | null
        }
        Relationships: []
      }
      project_stakeholders: {
        Row: {
          account_id: string
          created_at: string
          id: string
          org_id: string
          project_id: string
          stakeholder_role: Database["public"]["Enums"]["project_stakeholder_role"]
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          org_id: string
          project_id: string
          stakeholder_role: Database["public"]["Enums"]["project_stakeholder_role"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string
          stakeholder_role?: Database["public"]["Enums"]["project_stakeholder_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          estimated_completion_date: string | null
          estimated_construction_date: string | null
          estimated_size: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          org_id: string
          project_type: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimated_completion_date?: string | null
          estimated_construction_date?: string | null
          estimated_size?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          org_id: string
          project_type?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimated_completion_date?: string | null
          estimated_construction_date?: string | null
          estimated_size?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          project_type?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_assignments: {
        Row: {
          created_at: string
          id: string
          org_id: string
          rep_membership_id: string
          support_membership_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          rep_membership_id: string
          support_membership_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          rep_membership_id?: string
          support_membership_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_assignments_rep_membership_id_fkey"
            columns: ["rep_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      territories: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          region: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "territories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_hierarchy: {
        Row: {
          ancestor_id: string
          created_at: string
          depth: number
          descendant_id: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          ancestor_id: string
          created_at?: string
          depth: number
          descendant_id: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          ancestor_id?: string
          created_at?: string
          depth?: number
          descendant_id?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_hierarchy_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_hierarchy_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_active_org_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          last_active_org_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_active_org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_last_active_org_id_fkey"
            columns: ["last_active_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_captures: {
        Row: {
          activity_id: string | null
          ai_draft: Json | null
          audio_path: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          language: string | null
          org_id: string
          owner_id: string
          reviewed_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["voice_capture_status"]
          transcript: string | null
          updated_at: string
        }
        Insert: {
          activity_id?: string | null
          ai_draft?: Json | null
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language?: string | null
          org_id: string
          owner_id: string
          reviewed_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          activity_id?: string | null
          ai_draft?: Json | null
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language?: string | null
          org_id?: string
          owner_id?: string
          reviewed_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_captures_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      set_active_org: { Args: { p_org_id: string }; Returns: undefined }
    }
    Enums: {
      account_type:
        | "DISTRIBUTOR"
        | "DEALER"
        | "CONTRACTOR"
        | "ARCHITECT"
        | "BUILDER"
        | "OTHER"
      activity_account_role: "PRIMARY" | "INVOLVED"
      activity_outcome:
        | "RELATIONSHIP_DEVELOPMENT"
        | "OPPORTUNITY_IDENTIFIED"
        | "PROJECT_IDENTIFIED"
        | "QUOTE_REQUESTED"
        | "SAMPLE_REQUESTED"
        | "TECHNICAL_SUPPORT_NEEDED"
        | "TRAINING_NEEDED"
        | "NO_IMMEDIATE_OPPORTUNITY"
      activity_type:
        | "DEALER_VISIT"
        | "DISTRIBUTOR_VISIT"
        | "CONTRACTOR_MEETING"
        | "ARCHITECT_MEETING"
        | "JOBSITE_VISIT"
        | "PK_TRAINING"
        | "PHONE_CALL"
        | "QUOTE_FOLLOWUP"
        | "SAMPLE_FOLLOWUP"
        | "EMAIL"
        | "OTHER"
      attachment_classification:
        | "QUOTE"
        | "SPEC_SHEET"
        | "DRAWING"
        | "SUBMITTAL"
        | "PHOTO"
        | "INVOICE"
        | "OTHER"
      candidate_source: "MANUAL" | "VOICE" | "BUSINESS_CARD" | "EMAIL_METADATA"
      candidate_status: "PENDING" | "CONFIRMED" | "MERGED" | "DISCARDED"
      email_direction: "INBOUND" | "OUTBOUND"
      influence_level: "LOW" | "MEDIUM" | "HIGH" | "DECISION_MAKER"
      integration_provider: "anthropic" | "openai" | "google" | "workspace"
      membership_role: "rep" | "manager" | "admin" | "support"
      membership_status: "active" | "suspended"
      opportunity_stage:
        | "IDENTIFIED"
        | "QUALIFIED"
        | "DEVELOPMENT"
        | "QUOTE"
        | "DECISION"
        | "WON"
        | "LOST"
        | "ON_HOLD"
      org_status: "active" | "suspended"
      project_stakeholder_role:
        | "ARCHITECT"
        | "CONTRACTOR"
        | "BUILDER"
        | "DEVELOPER"
        | "DEALER"
        | "DISTRIBUTOR"
        | "OTHER"
      project_status:
        | "PLANNING"
        | "DESIGN"
        | "BIDDING"
        | "UNDER_CONSTRUCTION"
        | "COMPLETED"
        | "ON_HOLD"
        | "CANCELLED"
      relationship_state: "ACTIVE" | "INACTIVE" | "UNCONFIRMED"
      relationship_status_value:
        | "PROSPECT"
        | "DEVELOPING"
        | "ESTABLISHED"
        | "AT_RISK"
        | "DORMANT"
      relationship_strength: "WEAK" | "MODERATE" | "STRONG"
      relationship_type:
        | "SUPPLIES"
        | "PURCHASES_FROM"
        | "WORKS_WITH"
        | "REFERRED_BY"
        | "REFERRED_TO"
        | "SPECIFIES_THROUGH"
        | "SUPPORTS"
        | "PREFERRED_PARTNER"
        | "INSTALLER_FOR"
        | "ARCHITECT_FOR"
        | "DEVELOPER_FOR"
      strategic_importance: "STRATEGIC" | "HIGH" | "MEDIUM" | "LOW"
      visit_objective:
        | "COLLECT_QUOTE"
        | "MEET_CONTRACTOR"
        | "CONVERT_STOCKING_DEALER"
        | "FOLLOW_UP_LEAD"
        | "PK_DELIVERY"
        | "MERCHANDISING_CHECK"
        | "RELATIONSHIP_MAINTENANCE"
        | "OTHER"
      voice_capture_status:
        | "PENDING"
        | "UPLOADED"
        | "TRANSCRIBED"
        | "DRAFTED"
        | "REVIEWED"
        | "SENT"
        | "DISCARDED"
        | "FAILED"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_type: [
        "DISTRIBUTOR",
        "DEALER",
        "CONTRACTOR",
        "ARCHITECT",
        "BUILDER",
        "OTHER",
      ],
      activity_account_role: ["PRIMARY", "INVOLVED"],
      activity_outcome: [
        "RELATIONSHIP_DEVELOPMENT",
        "OPPORTUNITY_IDENTIFIED",
        "PROJECT_IDENTIFIED",
        "QUOTE_REQUESTED",
        "SAMPLE_REQUESTED",
        "TECHNICAL_SUPPORT_NEEDED",
        "TRAINING_NEEDED",
        "NO_IMMEDIATE_OPPORTUNITY",
      ],
      activity_type: [
        "DEALER_VISIT",
        "DISTRIBUTOR_VISIT",
        "CONTRACTOR_MEETING",
        "ARCHITECT_MEETING",
        "JOBSITE_VISIT",
        "PK_TRAINING",
        "PHONE_CALL",
        "QUOTE_FOLLOWUP",
        "SAMPLE_FOLLOWUP",
        "EMAIL",
        "OTHER",
      ],
      attachment_classification: [
        "QUOTE",
        "SPEC_SHEET",
        "DRAWING",
        "SUBMITTAL",
        "PHOTO",
        "INVOICE",
        "OTHER",
      ],
      candidate_source: ["MANUAL", "VOICE", "BUSINESS_CARD", "EMAIL_METADATA"],
      candidate_status: ["PENDING", "CONFIRMED", "MERGED", "DISCARDED"],
      email_direction: ["INBOUND", "OUTBOUND"],
      influence_level: ["LOW", "MEDIUM", "HIGH", "DECISION_MAKER"],
      integration_provider: ["anthropic", "openai", "google", "workspace"],
      membership_role: ["rep", "manager", "admin", "support"],
      membership_status: ["active", "suspended"],
      opportunity_stage: [
        "IDENTIFIED",
        "QUALIFIED",
        "DEVELOPMENT",
        "QUOTE",
        "DECISION",
        "WON",
        "LOST",
        "ON_HOLD",
      ],
      org_status: ["active", "suspended"],
      project_stakeholder_role: [
        "ARCHITECT",
        "CONTRACTOR",
        "BUILDER",
        "DEVELOPER",
        "DEALER",
        "DISTRIBUTOR",
        "OTHER",
      ],
      project_status: [
        "PLANNING",
        "DESIGN",
        "BIDDING",
        "UNDER_CONSTRUCTION",
        "COMPLETED",
        "ON_HOLD",
        "CANCELLED",
      ],
      relationship_state: ["ACTIVE", "INACTIVE", "UNCONFIRMED"],
      relationship_status_value: [
        "PROSPECT",
        "DEVELOPING",
        "ESTABLISHED",
        "AT_RISK",
        "DORMANT",
      ],
      relationship_strength: ["WEAK", "MODERATE", "STRONG"],
      relationship_type: [
        "SUPPLIES",
        "PURCHASES_FROM",
        "WORKS_WITH",
        "REFERRED_BY",
        "REFERRED_TO",
        "SPECIFIES_THROUGH",
        "SUPPORTS",
        "PREFERRED_PARTNER",
        "INSTALLER_FOR",
        "ARCHITECT_FOR",
        "DEVELOPER_FOR",
      ],
      strategic_importance: ["STRATEGIC", "HIGH", "MEDIUM", "LOW"],
      visit_objective: [
        "COLLECT_QUOTE",
        "MEET_CONTRACTOR",
        "CONVERT_STOCKING_DEALER",
        "FOLLOW_UP_LEAD",
        "PK_DELIVERY",
        "MERCHANDISING_CHECK",
        "RELATIONSHIP_MAINTENANCE",
        "OTHER",
      ],
      voice_capture_status: [
        "PENDING",
        "UPLOADED",
        "TRANSCRIBED",
        "DRAFTED",
        "REVIEWED",
        "SENT",
        "DISCARDED",
        "FAILED",
      ],
    },
  },
} as const

