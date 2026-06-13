export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      shifts: {
        Row: {
          id: string;
          date: string;
          status: "planned" | "active" | "closed";
          location_name: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          date: string;
          status?: "planned" | "active" | "closed";
          location_name?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          date?: string;
          status?: "planned" | "active" | "closed";
          location_name?: string | null;
          notes?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
