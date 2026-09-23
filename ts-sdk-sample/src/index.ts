import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

/**
 * メインメソッド
 */
const main = async() => {
    // TypeSage Client Instance
    const client = new TypeSafeClient();

    // Call Typesage API
    const response = await client.systemOne({
        state: { 
            document: "I was charged twice. Please fix this ASAP." 
        },
        questions: {
            category: choice("What is this ticket about?", {
                billing: null,
                technical: null,
                other: null,
            }),
        },
    });

    console.log(response.answers.category.choice);
};

main();