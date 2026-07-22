export default async function handler(req,res){

if(req.method!=="POST"){

return res.status(405).json({
message:"Method Not Allowed"
});

}

const body=req.body;

console.log(body);

// TODO:
// Gọi API Thẻ Siêu Rẻ tại đây
// Kiểm tra kết quả
// Cập nhật trạng thái

return res.status(200).json({

success:true,

message:"Đã nhận yêu cầu đổi thẻ"

});

}
