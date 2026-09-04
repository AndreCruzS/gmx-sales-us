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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_a_id_fkey"
            columns: ["account_a_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "account_relationships_account_b_id_fkey"
            columns: ["account_b_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      account_rollout: {
        Row: {
          account_id: string
          created_at: string
          material_state: Database["public"]["Enums"]["rollout_gate_state"]
          merchandiser_state: Database["public"]["Enums"]["rollout_gate_state"]
          notes: string | null
          org_id: string
          pk_count: number
          pk_state: Database["public"]["Enums"]["rollout_gate_state"]
          product: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          material_state?: Database["public"]["Enums"]["rollout_gate_state"]
          merchandiser_state?: Database["public"]["Enums"]["rollout_gate_state"]
          notes?: string | null
          org_id: string
          pk_count?: number
          pk_state?: Database["public"]["Enums"]["rollout_gate_state"]
          product?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          material_state?: Database["public"]["Enums"]["rollout_gate_state"]
          merchandiser_state?: Database["public"]["Enums"]["rollout_gate_state"]
          notes?: string | null
          org_id?: string
          pk_count?: number
          pk_state?: Database["public"]["Enums"]["rollout_gate_state"]
          product?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "account_rollout_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "account_rollout_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
          hubspot_id: string | null
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
          territory_id: string | null
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
          hubspot_id?: string | null
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
          territory_id?: string | null
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
          hubspot_id?: string | null
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
          territory_id?: string | null
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "accounts_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
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
          hubspot_id: string | null
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
          hubspot_id?: string | null
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
          hubspot_id?: string | null
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
            referencedRelation: "exception_opportunity_no_next_action"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_stale"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_quote_no_follow_up"
            referencedColumns: ["subject_id"]
          },
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "activities_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "exception_overdue_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_upcoming"
            referencedColumns: ["next_action_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "activities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "activity_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "activity_accounts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_accounts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_recent_activity"
            referencedColumns: ["activity_id"]
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
            foreignKeyName: "activity_contacts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_recent_activity"
            referencedColumns: ["activity_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "contact_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "contact_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contact_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "contact_candidates_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
          hubspot_id: string | null
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
          hubspot_id?: string | null
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
          hubspot_id?: string | null
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
      distributor_branches: {
        Row: {
          city: string | null
          created_at: string
          distributor_id: string
          external_code: string | null
          id: string
          name: string
          org_id: string
          state: string | null
          territory_id: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          distributor_id: string
          external_code?: string | null
          id?: string
          name: string
          org_id: string
          state?: string | null
          territory_id?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          distributor_id?: string
          external_code?: string | null
          id?: string
          name?: string
          org_id?: string
          state?: string | null
          territory_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "distributor_branches_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "distributor_branches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_branches_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "distributor_branches_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
          },
          {
            foreignKeyName: "distributor_branches_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
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
            referencedRelation: "exception_opportunity_no_next_action"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_attachments_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_stale"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_attachments_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_quote_no_follow_up"
            referencedColumns: ["subject_id"]
          },
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
            referencedRelation: "exception_project_no_dealer"
            referencedColumns: ["subject_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "email_sync_state_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "email_sync_state_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_sync_state_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sync_state_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
            referencedRelation: "exception_opportunity_no_next_action"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_stale"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_quote_no_follow_up"
            referencedColumns: ["subject_id"]
          },
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
            referencedRelation: "exception_project_no_dealer"
            referencedColumns: ["subject_id"]
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "email_threads_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "email_threads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "email_threads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "email_threads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      exception_snapshots: {
        Row: {
          cleared_at: string | null
          created_at: string
          detail: string | null
          detected_at: string
          exception_type: string
          id: string
          org_id: string
          owner_membership_id: string | null
          subject_id: string
          subject_type: string
          title: string | null
          updated_at: string
        }
        Insert: {
          cleared_at?: string | null
          created_at?: string
          detail?: string | null
          detected_at?: string
          exception_type: string
          id?: string
          org_id: string
          owner_membership_id?: string | null
          subject_id: string
          subject_type: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          cleared_at?: string | null
          created_at?: string
          detail?: string | null
          detected_at?: string
          exception_type?: string
          id?: string
          org_id?: string
          owner_membership_id?: string | null
          subject_id?: string
          subject_type?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exception_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_snapshots_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "exception_snapshots_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "exception_snapshots_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "exception_snapshots_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_snapshots_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      hubspot_sync_cursors: {
        Row: {
          created_at: string
          cursor: string
          org_id: string
          stream: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cursor: string
          org_id: string
          stream: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cursor?: string
          org_id?: string
          stream?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubspot_sync_cursors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hubspot_sync_errors: {
        Row: {
          created_at: string
          direction: string
          entity_id: string | null
          entity_type: string
          error: string
          hubspot_id: string | null
          id: string
          org_id: string
          payload: Json
          resolved_at: string | null
          retry_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          entity_id?: string | null
          entity_type: string
          error: string
          hubspot_id?: string | null
          id?: string
          org_id: string
          payload: Json
          resolved_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          entity_id?: string | null
          entity_type?: string
          error?: string
          hubspot_id?: string | null
          id?: string
          org_id?: string
          payload?: Json
          resolved_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubspot_sync_errors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hubspot_sync_snapshots: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          hubspot_id: string
          org_id: string
          synced_at: string
          synced_props: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          hubspot_id: string
          org_id: string
          synced_at?: string
          synced_props: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          hubspot_id?: string
          org_id?: string
          synced_at?: string
          synced_props?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubspot_sync_snapshots_org_id_fkey"
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "memberships_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "memberships_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "memberships_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "memberships_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
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
          hubspot_id: string | null
          id: string
          kind: Database["public"]["Enums"]["next_action_kind"] | null
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
          hubspot_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["next_action_kind"] | null
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
          hubspot_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["next_action_kind"] | null
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "next_actions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_recent_activity"
            referencedColumns: ["activity_id"]
          },
          {
            foreignKeyName: "next_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_no_next_action"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_stale"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_quote_no_follow_up"
            referencedColumns: ["subject_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "next_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "exception_project_no_dealer"
            referencedColumns: ["subject_id"]
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
          hubspot_id: string | null
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
          hubspot_id?: string | null
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
          hubspot_id?: string | null
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_architect_id_fkey"
            columns: ["architect_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_primary_account_id_fkey"
            columns: ["primary_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "exception_project_no_dealer"
            referencedColumns: ["subject_id"]
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "opportunities_referring_account_id_fkey"
            columns: ["referring_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "opportunities_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "opportunities_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
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
      opportunity_stage_events: {
        Row: {
          changed_by: string | null
          created_at: string
          from_stage: Database["public"]["Enums"]["opportunity_stage"] | null
          id: string
          occurred_at: string
          opportunity_id: string
          org_id: string
          to_stage: Database["public"]["Enums"]["opportunity_stage"]
          updated_at: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          occurred_at?: string
          opportunity_id: string
          org_id: string
          to_stage: Database["public"]["Enums"]["opportunity_stage"]
          updated_at?: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          occurred_at?: string
          opportunity_id?: string
          org_id?: string
          to_stage?: Database["public"]["Enums"]["opportunity_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_no_next_action"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_opportunity_stale"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exception_quote_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
          workspace_domain: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
          workspace_domain?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
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
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
            referencedRelation: "exception_project_no_dealer"
            referencedColumns: ["subject_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      rep_calendars: {
        Row: {
          created_at: string
          google_calendar_id: string
          id: string
          membership_id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_calendar_id: string
          id?: string
          membership_id: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_calendar_id?: string
          id?: string
          membership_id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_calendars_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "rep_calendars_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "rep_calendars_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "rep_calendars_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_calendars_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "rep_calendars_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_through: {
        Row: {
          branch_id: string
          created_at: string
          dealer_id: string | null
          dealer_label: string
          id: string
          ly_quantity: number | null
          org_id: string
          period: string
          product: string | null
          quantity: number
          source_quantity: number | null
          source_unit: string | null
          unit: string
          updated_at: string
          upload_id: string
          value: number | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          dealer_id?: string | null
          dealer_label: string
          id?: string
          ly_quantity?: number | null
          org_id: string
          period: string
          product?: string | null
          quantity?: number
          source_quantity?: number | null
          source_unit?: string | null
          unit?: string
          updated_at?: string
          upload_id: string
          value?: number | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          dealer_id?: string | null
          dealer_label?: string
          id?: string
          ly_quantity?: number | null
          org_id?: string
          period?: string
          product?: string | null
          quantity?: number
          source_quantity?: number | null
          source_unit?: string | null
          unit?: string
          updated_at?: string
          upload_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_through_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "distributor_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["branch_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "sell_through_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "sell_through_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "sell_through_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_through_uploads: {
        Row: {
          distributor_id: string
          filename: string | null
          id: string
          notes: string | null
          org_id: string
          period: string
          period_kind: Database["public"]["Enums"]["sell_period_kind"]
          row_count: number
          storage_path: string | null
          unmatched_count: number
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          distributor_id: string
          filename?: string | null
          id?: string
          notes?: string | null
          org_id: string
          period: string
          period_kind?: Database["public"]["Enums"]["sell_period_kind"]
          row_count?: number
          storage_path?: string | null
          unmatched_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          distributor_id?: string
          filename?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          period?: string
          period_kind?: Database["public"]["Enums"]["sell_period_kind"]
          row_count?: number
          storage_path?: string | null
          unmatched_count?: number
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "sell_through_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_through_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "support_assignments_rep_membership_id_fkey"
            columns: ["rep_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "support_assignments_rep_membership_id_fkey"
            columns: ["rep_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "support_assignments_rep_membership_id_fkey"
            columns: ["rep_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_assignments_rep_membership_id_fkey"
            columns: ["rep_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_assignments_support_membership_id_fkey"
            columns: ["support_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      territory_states: {
        Row: {
          created_at: string
          org_id: string
          state: string
          territory_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          org_id: string
          state: string
          territory_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          org_id?: string
          state?: string
          territory_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "territory_states_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_states_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "territory_states_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
          },
          {
            foreignKeyName: "territory_states_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "user_hierarchy_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "user_hierarchy_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "user_hierarchy_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_hierarchy_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_hierarchy_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
          account_id: string | null
          activity_id: string | null
          ai_draft: Json | null
          audio_path: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          language: string | null
          org_id: string
          owner_id: string
          planned_action_id: string | null
          reviewed_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["voice_capture_status"]
          transcript: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          activity_id?: string | null
          ai_draft?: Json | null
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language?: string | null
          org_id: string
          owner_id: string
          planned_action_id?: string | null
          reviewed_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          activity_id?: string | null
          ai_draft?: Json | null
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          language?: string | null
          org_id?: string
          owner_id?: string
          planned_action_id?: string | null
          reviewed_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "voice_captures_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "voice_captures_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_recent_activity"
            referencedColumns: ["activity_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "voice_captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "voice_captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "voice_captures_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "exception_overdue_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "voice_captures_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_planned_action_id_fkey"
            columns: ["planned_action_id"]
            isOneToOne: false
            referencedRelation: "weekly_review_upcoming"
            referencedColumns: ["next_action_id"]
          },
        ]
      }
    }
    Views: {
      account_rollout_status: {
        Row: {
          account_id: string | null
          display_wall_state:
            | Database["public"]["Enums"]["rollout_gate_state"]
            | null
          gates_done: number | null
          material_state:
            | Database["public"]["Enums"]["rollout_gate_state"]
            | null
          merchandiser_state:
            | Database["public"]["Enums"]["rollout_gate_state"]
            | null
          name: string | null
          notes: string | null
          org_id: string | null
          owner_id: string | null
          parent_account_id: string | null
          pk_count: number | null
          pk_state: Database["public"]["Enums"]["rollout_gate_state"] | null
          product: string | null
          territory_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rollout_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
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
      dashboard_activity: {
        Row: {
          activity_count: number | null
          activity_type: Database["public"]["Enums"]["activity_type"] | null
          org_id: string | null
          owner_id: string | null
          planned_count: number | null
          territory_id: string | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
          },
          {
            foreignKeyName: "accounts_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      dashboard_customer_sales: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          customer_type: string | null
          open_qty: number | null
          open_value: number | null
          org_id: string | null
          out_qty: number | null
          out_value: number | null
          owner_id: string | null
          unit: string | null
          won_qty: number | null
          won_value: number | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      dashboard_network_growth: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"] | null
          new_accounts: number | null
          org_id: string | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_pipeline: {
        Row: {
          oldest_updated_at: string | null
          opportunity_count: number | null
          org_id: string | null
          owner_id: string | null
          stage: Database["public"]["Enums"]["opportunity_stage"] | null
          territory_id: string | null
          total_value: number | null
          weighted_value: number | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "opportunities_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "opportunities_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
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
      dashboard_plan_by_channel: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          distributor_id: string | null
          distributor_name: string | null
          distributor_options: number | null
          org_id: string | null
          owner_id: string | null
          planned_done: number | null
          planned_missed: number | null
          planned_owed: number | null
          planned_total: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_rollout_status"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_customer_sales"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "dashboard_won_monthly"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_display_not_verified"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_new_account_no_follow_up"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_no_champion"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exception_strategic_account_quiet"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["dealer_id"]
          },
          {
            foreignKeyName: "next_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["distributor_id"]
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      dashboard_planned_vs_actual: {
        Row: {
          org_id: string | null
          owner_id: string | null
          planned_done: number | null
          planned_total: number | null
          unplanned: number | null
          week_start: string | null
        }
        Relationships: []
      }
      dashboard_relationship_growth: {
        Row: {
          new_relationships: number | null
          org_id: string | null
          relationship_type:
            | Database["public"]["Enums"]["relationship_type"]
            | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_relationships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_rep_scorecard: {
        Row: {
          activities_30d: number | null
          last_activity_at: string | null
          membership_id: string | null
          open_next_actions: number | null
          open_opportunities: number | null
          org_id: string | null
          overdue_next_actions: number | null
          pipeline_value: number | null
          quotes_outstanding: number | null
          rep_name: string | null
          territory_id: string | null
          territory_name: string | null
          weighted_value: number | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_territory"
            referencedColumns: ["territory_id"]
          },
          {
            foreignKeyName: "memberships_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["region_id"]
          },
          {
            foreignKeyName: "memberships_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_rollout: {
        Row: {
          branches: number | null
          display_wall_done: number | null
          display_wall_pending: number | null
          fully_through: number | null
          material_done: number | null
          material_pending: number | null
          merchandiser_done: number | null
          merchandiser_pending: number | null
          not_started: number | null
          org_id: string | null
          pk_done: number | null
          pk_pending: number | null
          pk_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_stage_flow: {
        Row: {
          advanced: number | null
          created: number | null
          lost: number | null
          org_id: string | null
          owner_id: string | null
          week_start: string | null
          won: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_territory: {
        Row: {
          account_count: number | null
          accounts_with_activity_30d: number | null
          open_opportunities: number | null
          org_id: string | null
          pipeline_value: number | null
          project_count: number | null
          strategic_accounts: number | null
          territory_id: string | null
          territory_name: string | null
        }
        Insert: {
          account_count?: never
          accounts_with_activity_30d?: never
          open_opportunities?: never
          org_id?: string | null
          pipeline_value?: never
          project_count?: never
          strategic_accounts?: never
          territory_id?: string | null
          territory_name?: string | null
        }
        Update: {
          account_count?: never
          accounts_with_activity_30d?: never
          open_opportunities?: never
          org_id?: string | null
          pipeline_value?: never
          project_count?: never
          strategic_accounts?: never
          territory_id?: string | null
          territory_name?: string | null
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
      dashboard_won_monthly: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          customer_type: string | null
          deals: number | null
          month: string | null
          org_id: string | null
          owner_id: string | null
          unit: string | null
          won_qty: number | null
          won_value: number | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_contractor_relationship_stale: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_relationships_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      exception_display_not_verified: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
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
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_new_account_no_follow_up: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
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
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_next_week_not_planned: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_no_champion: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Insert: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Update: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
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
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_opportunity_no_next_action: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Insert: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Update: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_opportunity_stale: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_overdue_follow_up: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Insert: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: never
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Update: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: never
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "next_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_project_no_dealer: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Insert: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Update: {
          detail?: never
          exception_type?: never
          org_id?: string | null
          owner_membership_id?: string | null
          since?: string | null
          subject_id?: string | null
          subject_type?: never
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
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
      exception_quote_no_follow_up: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exception_strategic_account_quiet: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
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
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      exceptions: {
        Row: {
          detail: string | null
          exception_type: string | null
          org_id: string | null
          owner_membership_id: string | null
          since: string | null
          subject_id: string | null
          subject_type: string | null
          title: string | null
        }
        Relationships: []
      }
      routine_items: {
        Row: {
          account_id: string | null
          account_name: string | null
          action: string | null
          context_date: string | null
          due_date: string | null
          item_id: string | null
          kind: string | null
          org_id: string | null
          owner_membership_id: string | null
        }
        Relationships: []
      }
      sell_through_latest_period: {
        Row: {
          org_id: string | null
          period: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_through_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_through_rows: {
        Row: {
          branch_city: string | null
          branch_id: string | null
          branch_name: string | null
          branch_state: string | null
          dealer_id: string | null
          dealer_label: string | null
          dealer_name: string | null
          distributor_id: string | null
          distributor_name: string | null
          ly_quantity: number | null
          market_owner_id: string | null
          market_owner_name: string | null
          org_id: string | null
          period: string | null
          period_kind: Database["public"]["Enums"]["sell_period_kind"] | null
          product: string | null
          quantity: number | null
          region_id: string | null
          region_name: string | null
          rep_id: string | null
          rep_name: string | null
          unit: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_through_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_review_new_objects: {
        Row: {
          created_at: string | null
          name: string | null
          object_id: string | null
          object_type: string | null
          org_id: string | null
          owner_id: string | null
        }
        Relationships: []
      }
      weekly_review_recent_activity: {
        Row: {
          account_name: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          activity_id: string | null
          activity_type: Database["public"]["Enums"]["activity_type"] | null
          commercial_potential: string | null
          follow_up_required: boolean | null
          key_information: string | null
          occurred_at: string | null
          org_id: string | null
          outcomes: Database["public"]["Enums"]["activity_outcome"][] | null
          owner_id: string | null
          was_planned: boolean | null
          week_start: string | null
          what_happened: string | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
      weekly_review_upcoming: {
        Row: {
          account_name: string | null
          action: string | null
          due_date: string | null
          next_action_id: string | null
          objective: Database["public"]["Enums"]["visit_objective"] | null
          opportunity_name: string | null
          org_id: string | null
          owner_id: string | null
          week_start: string | null
        }
        Relationships: [
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
            referencedRelation: "dashboard_rep_scorecard"
            referencedColumns: ["membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["owner_membership_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exception_next_week_not_planned"
            referencedColumns: ["subject_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "sell_through_rows"
            referencedColumns: ["market_owner_id"]
          },
        ]
      }
    }
    Functions: {
      create_opportunity_with_action: {
        Args: { p_next_action: Json; p_opportunity: Json }
        Returns: undefined
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      get_integration_secret: { Args: { p_ref: string }; Returns: string }
      hubspot_apply_deal: {
        Args: {
          p_opportunity_id: string
          p_org_id: string
          p_patch: Json
          p_review_action: Json
        }
        Returns: undefined
      }
      set_active_org: { Args: { p_org_id: string }; Returns: undefined }
      territory_for_state: {
        Args: { p_org: string; p_state: string }
        Returns: string
      }
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
      integration_provider:
        | "anthropic"
        | "openai"
        | "google"
        | "workspace"
        | "hubspot"
      membership_role: "rep" | "manager" | "admin" | "support"
      membership_status: "active" | "suspended"
      next_action_kind:
        | "VISIT"
        | "SAMPLE_FOLLOW_UP"
        | "QUOTE_FOLLOW_UP"
        | "DISPLAY_CHECK"
        | "OTHER"
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
      rollout_gate_state: "OK" | "PENDING" | "NO"
      sell_period_kind: "MONTH" | "YTD"
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
      integration_provider: [
        "anthropic",
        "openai",
        "google",
        "workspace",
        "hubspot",
      ],
      membership_role: ["rep", "manager", "admin", "support"],
      membership_status: ["active", "suspended"],
      next_action_kind: [
        "VISIT",
        "SAMPLE_FOLLOW_UP",
        "QUOTE_FOLLOW_UP",
        "DISPLAY_CHECK",
        "OTHER",
      ],
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
      rollout_gate_state: ["OK", "PENDING", "NO"],
      sell_period_kind: ["MONTH", "YTD"],
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
