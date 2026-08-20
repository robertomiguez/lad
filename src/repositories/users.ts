import { ROLE, type Role } from "../domain/roles";

export type DbUser = { id: string; name: string; role: Role; store_id: string | null };
export type StoreWorkspaceUser = { name: string; store_name: string };

export class UsersRepository {
  constructor(private readonly db: D1Database) {}

  async listForLogin() {
    return (await this.db.prepare("SELECT id, name, role FROM users ORDER BY CASE role WHEN ? THEN 1 WHEN ? THEN 2 WHEN ? THEN 3 ELSE 4 END, name").bind(ROLE.store, ROLE.regionalManager, ROLE.quality).all<Pick<DbUser, "id" | "name" | "role">>()).results;
  }

  findById(id: string) {
    return this.db.prepare("SELECT id, name, role, store_id FROM users WHERE id = ?").bind(id).first<DbUser>();
  }

  findStoreWorkspace(userId: string) {
    return this.db.prepare("SELECT u.name, s.name AS store_name FROM users u JOIN stores s ON s.id = u.store_id WHERE u.id = ?").bind(userId).first<StoreWorkspaceUser>();
  }
}
