import { TypeSafeClient, choice, score, noul } from "@typesafe-ai/sdk";

/**
 * メイン関数
 */
const main = async() => {
    // クライアントインスタンスを生成
    const client = new TypeSafeClient();

    // typesafe AIを呼び出す
    const response = await client.systemOne({
        model: "jev-1.13.0",
        state: {
            "ticket": {
                "subject": "Duplicate subscription charge",
                "message": "I was charged twice this month. Please refund the duplicate before Friday."
            },
            "customer_plan": "pro"
        },
        questions: {
            department: choice("Which team should handle this ticket?", {
                billing: "Payments and refunds", technical: "Bugs and outages",
                sales: "New purchases", other: "None of these"
            }),
            urgency: score("How urgent is the request?", [
                "No deadline", 
                "This week", 
                "Within a day", 
                "Immediate harm"
            ]),
            refund_requested: noul("Does the customer explicitly request a refund?")
        }
    });

    const answer = response.answers.department;
    // Educational threshold; validate on labeled tickets before deployment.
    const queue = answer.confidence >= 0.85 ? answer.choice : "manual_review";

    console.log({ 
        queue, probabilities: answer.probabilities,
        urgency: response.answers.urgency.score,
        refundRequested: response.answers.refund_requested.noul,
        model: response.model, usage: response.usage 
    });
}

main();