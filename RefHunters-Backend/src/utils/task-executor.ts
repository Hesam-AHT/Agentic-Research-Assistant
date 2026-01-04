import * as A1 from "../agents/a1/a1.js";
import * as A2 from "../agents/a2/a2.js";

export class TaskExecutor {
    private agentRegistry = {
        A1: { run: A1.run },
        A2: { run: A2.run },
    };

    async executeTask(task: any): Promise<any> {
        if (task.agent === "A1") {
            return await this.agentRegistry.A1.run(task);
        } else {
            return await this.agentRegistry.A2.run(task);
        }
    }
}
