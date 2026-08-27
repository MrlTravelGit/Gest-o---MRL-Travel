import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
db.exec(`
create table if not exists vault_users(
 id text primary key,username text not null unique,password_hash text not null,role text not null,
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
 marital_status_enc text,passport_number_enc text,passport_country_enc text,passport_expiry_enc text,
 check(status in ('active','archived','no_term'))
);
create table if not exists vault_client_sync_index(
 client_id text primary key,display_name text not null,contract_start_date text,contract_end_date text,
 event_type text not null,sync_status text not null default 'pending',last_error text,occurred_at text not null,updated_at text not null,
 check(sync_status in ('pending','synced','failed','archived'))
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
create table if not exists vault_cards(
 id text primary key,client_id text not null references vault_clients(client_id),bank_enc text not null,brand text not null,
 card_name_enc text not null,last_four text not null,earning_rate text,earning_currency text,destination_program text,
 closing_day integer,due_day integer,notes_enc text,created_by text not null,updated_by text not null,created_at text not null,updated_at text not null,deleted_at text,
 check(length(last_four)=4 and last_four not glob '*[^0-9]*'),check(earning_currency in ('USD','BRL') or earning_currency is null),
 check(closing_day between 1 and 31 or closing_day is null),check(due_day between 1 and 31 or due_day is null)
);
create table if not exists vault_passports(
 id text primary key,client_id text not null references vault_clients(client_id),number_enc text not null,issuer_country text,
 issued_on text,expires_on text,nationality text,document_id text references vault_documents(id),notes_enc text,
 created_by text not null,updated_by text not null,created_at text not null,updated_at text not null,deleted_at text
);
create table if not exists vault_visas(
 id text primary key,client_id text not null references vault_clients(client_id),visa_type text,country text not null,
 issued_on text,expires_on text,passport_id text references vault_passports(id),document_id text references vault_documents(id),notes_enc text,
 created_by text not null,updated_by text not null,created_at text not null,updated_at text not null,deleted_at text
);
create table if not exists vault_audit_events(
 event_id text primary key,timestamp text not null,user_id text,action text not null,client_id text,object_type text,object_id text,
 result text not null,local_address text,justification text,metadata_json text not null default '{}'
);
create table if not exists processed_outbox_events(event_id text primary key,processed_at text not null);
create index if not exists vault_credentials_client_idx on vault_credentials(client_id,status,deleted_at);
create index if not exists vault_documents_client_idx on vault_documents(client_id,document_type,expires_on,deleted_at);
create index if not exists vault_client_sync_status_idx on vault_client_sync_index(sync_status,updated_at desc);
create index if not exists vault_cards_client_idx on vault_cards(client_id,deleted_at);
create index if not exists vault_passports_client_idx on vault_passports(client_id,expires_on,deleted_at);
create index if not exists vault_visas_client_idx on vault_visas(client_id,expires_on,deleted_at);
create index if not exists vault_audit_time_idx on vault_audit_events(timestamp desc);
`);

const allowedUserColumns = ["id","username","password_hash","role","active","failed_attempts","locked_until","created_at","updated_at"];
const existingUserColumns = (db.prepare("pragma table_info(vault_users)").all() as Array<{name:string}>).map((column) => column.name);
if (existingUserColumns.some((column) => !allowedUserColumns.includes(column))) {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
  try {
    db.exec(`create table vault_users_clean(id text primary key,username text not null unique,password_hash text not null,role text not null,active integer not null default 1,failed_attempts integer not null default 0,locked_until text,created_at text not null,updated_at text not null,check(role in ('vault_admin','vault_operator','vault_auditor')));
      insert into vault_users_clean(${allowedUserColumns.join(",")}) select ${allowedUserColumns.join(",")} from vault_users;
      drop table vault_users; alter table vault_users_clean rename to vault_users; COMMIT;`);
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
  finally { db.exec("PRAGMA foreign_keys=ON;"); }
}

// Migração incremental — adiciona colunas novas a bancos pré-existentes
for (const col of ["marital_status_enc","passport_number_enc","passport_country_enc","passport_expiry_enc","rg_issuer_enc","nationality_enc","whatsapp_enc"]) {
  const exists = (db.prepare("pragma table_info(vault_clients)").all() as Array<{name:string}>).some((c) => c.name === col);
  if (!exists) db.exec(`alter table vault_clients add column ${col} text`);
}

export type SqlValue = string|number|null;
export function one<T>(sql:string,...params:SqlValue[]):T|undefined{return db.prepare(sql).get(...params) as T|undefined;}
export function all<T>(sql:string,...params:SqlValue[]):T[]{return db.prepare(sql).all(...params) as T[];}
export function run(sql:string,...params:SqlValue[]){return db.prepare(sql).run(...params);}
export function transaction<T>(fn:()=>T):T{db.exec("BEGIN IMMEDIATE");try{const value=fn();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}
