export type UserRole = 'user' | 'moderator' | 'admin' | 'douanier';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  roles?: string[];
  email_verified?: boolean;
  discord_linked?: boolean;
  discord_username?: string;
  whitelist_status?: 'pending' | 'rp_approved' | 'hrp_pending' | 'hrp_approved' | 'oral_pending' | 'oral_scheduled' | 'approved' | 'rejected' | 'none';
}

export interface WhitelistApplication {
  id: string;
  user_id: string;
  username: string;
  character_name: string;
  character_backstory: string;
  character_age: number;
  character_blood_status: string;
  character_house_preference: string;
  roleplay_experience: string;
  why_join: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  review_notes?: string;
}
