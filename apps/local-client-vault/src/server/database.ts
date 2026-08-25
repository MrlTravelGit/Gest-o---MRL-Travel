import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
db.exec(`
create table if not exists vault_users(
 id text primary key,username text not null unique,password_hash text not null,mfa_secret_enc text not null,role text not null,
 active integer not null default 1,failed_attempts integer not null default 0,locked_until text,created_at text not null,updated_at text not null,
 check(role in ('vault_admin','vault_operator','vault_auditor'))
);
create table if not exists vault_sessions(
 id text primary key,user_id text not null references vault_users(id),token_hash text not null unique,csrf_hash text not null,
 created_at text not null,last_activity_at text not null,expires_at text not null,revoked_at text,local_address text
);
create table if not exists vault_clients(
 client_id text primary key,display_name text not null,status text not null default 'active',contract_start_date text,contract_end_date text,
 sync_status text not null default 'synced',created_at text not null,updated_at text not null,last_admin_user_id text,
 cpf_enc text,rg_enc text,birth_date_enc text,email_enc text,phone_enc text,address_enc text,private_notes_enc text,
 check(status in ('active','archived','no_term'))
);
create table if not exists vault_credentials(
 id text primary key,client_id text not null references vault_clients(client_id),service_name text not null,service_url text not null,icon_key text,
 login_enc text,password_enc text,notes_enc text,status text not null default 'active',changed_at text not null,review_on text,
 deleted_at text,created_by text not null,updated_by text not null,created_at text not null,updated_at text not null,
 check(status in ('active','review','blocked','inactive'))
);
create table if not exists vault_documents(
 id text primary key,client_id text not null references vault_clients(client_id),title_enc text not null,original_name_enc text not null,description_enc text,
 document_type text not null,document_on text,expires_on text,country_code text,document_number_enc text,tags_enc text,
 physical_name text not null unique,size_bytes integer not null,mime_type text not null,sha256 text not null,file_key_enc text not null,
 status text not null default 'active',created_by text not null,created_at text not null,deleted_at text,unique(client_id,sha256)
);
create table if not exists vault_audit_events(
 event_id text primary key,timestamp text not null,user_id text,action text not null,client_id text,object_type text,object_id text,
 result text not null,local_address text,justification text,metadata_json text not null default '{}'
);
create table if not exists processed_outbox_events(event_id text primary key,processed_at text not null);
create index if not exists vault_credentials_client_idx on vault_credentials(client_id,status,deleted_at);
create index if not exists vault_documents_client_idx on vault_documents(client_id,document_type,expires_on,deleted_at);
create index if not exists vault_audit_time_idx on vault_audit_events(timestamp desc);
`);

export type SqlValue = string|number|null;
export function one<T>(sql:string,...params:SqlValue[]):T|undefined{return db.prepare(sql).get(...params) as T|undefined;}
export function all<T>(sql:string,...params:SqlValue[]):T[]{return db.prepare(sql).all(...params) as T[];}
export function run(sql:string,...params:SqlValue[]){return db.prepare(sql).run(...params);}
export function transaction<T>(fn:()=>T):T{db.exec("BEGIN IMMEDIATE");try{const value=fn();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}
